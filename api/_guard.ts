import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isOriginAllowed, getCorsConfig } from "./_cors";

// Files prefixed with "_" are not exposed as Vercel routes.

export type QuotaBucket = "chat" | "voice" | "speak" | "transcribe" | "search";

// Daily limits per install. Override with env, e.g. DAILY_LIMIT_VOICE=20.
// Voice sessions are capped at 10 minutes client-side, so 15 sessions ≈ 150 min/day worst case.
const DEFAULT_DAILY_LIMITS: Record<QuotaBucket, number> = {
  chat: 300,
  voice: 15,
  speak: 300,
  transcribe: 200,
  search: 100,
};
// Per-IP daily limits stop someone resetting their install id to get a fresh quota.
const IP_DAILY_MULTIPLIER = 3;
const BURST_WINDOW_MS = 60 * 1000;
const BURST_LIMIT = 30;

const burstHits = new Map<string, { count: number; resetAt: number }>();
const memoryCounts = new Map<string, number>();

/**
 * Abuse and spend protection for the public proxy. Returns false (and responds) when the
 * request should be rejected.
 *
 * - ALLOWED_ORIGINS (optional, comma-separated), e.g. "chrome-extension://<extension-id>,https://yourdomain.com".
 * - Daily quotas per install id (X-BwithU-Install header) and per IP. Stored in Upstash Redis
 *   when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set (global across instances),
 *   otherwise in memory per warm instance (development only — NOT safe for production).
 * - Origin header is NOT authentication; it is browser-enforced and can be absent/spoofed by non-browser clients.
 *   When ALLOWED_ORIGINS is configured, only listed origins are accepted. Requests without an Origin
 *   header are allowed for non-browser clients (curl, server-to-server) but blocked for browser clients
 *   by the CORS preflight check in each handler.
 */
export async function guard(req: VercelRequest, res: VercelResponse, bucket: QuotaBucket): Promise<boolean> {
  const corsConfig = getCorsConfig();
  const origin = String(req.headers.origin || "");

  // Origin check: when an allowlist is configured, only listed origins pass.
  // If no allowlist is configured, we allow all origins in development but log a warning.
  if (corsConfig.allowedOrigins.length > 0 && origin && !isOriginAllowed(origin, corsConfig)) {
    res.status(403).json({ error: "Origin not allowed." });
    return false;
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const installId = sanitizeId(String(req.headers["x-bwithu-install"] || ""));

  const now = Date.now();
  const burst = burstHits.get(ip);
  if (!burst || burst.resetAt < now) {
    burstHits.set(ip, { count: 1, resetAt: now + BURST_WINDOW_MS });
  } else if (++burst.count > BURST_LIMIT) {
    res.status(429).json({ error: "Slow down a little. Try again in a minute." });
    return false;
  }

  const limit = Number(process.env[`DAILY_LIMIT_${bucket.toUpperCase()}`]) || DEFAULT_DAILY_LIMITS[bucket];
  const day = new Date().toISOString().slice(0, 10);
  const keys = [`q:${bucket}:ip:${ip}:${day}`];
  if (installId) keys.push(`q:${bucket}:id:${installId}:${day}`);

  let counts: number[];
  try {
    counts = await incrementAtomic(keys);
  } catch (error) {
    // Fail CLOSED: quota store unavailable = reject request.
    // Do not fall back to in-memory in production (BwithU_PUBLIC=1 or Vercel env).
    const isProduction = process.env.BWITHU_PUBLIC === "1" || process.env.VERCEL === "1";
    console.error("Quota store failed", error);
    if (isProduction) {
      res.status(503).json({ error: "Service temporarily unavailable. Please try again later." });
      return false;
    }
    // Development fallback: in-memory per-instance (NOT for production)
    counts = keys.map((key) => {
      const next = (memoryCounts.get(key) ?? 0) + 1;
      memoryCounts.set(key, next);
      return next;
    });
  }

  const [ipCount, idCount = 0] = counts;
  if (ipCount > limit * IP_DAILY_MULTIPLIER || idCount > limit) {
    res.status(429).json({ error: "Daily limit reached. B will be back tomorrow!", quota: bucket });
    return false;
  }
  return true;
}

function sanitizeId(value: string) {
  return /^[a-zA-Z0-9-]{8,64}$/.test(value) ? value : "";
}

/**
 * Atomically increments quota keys with TTL using a Lua script.
 * This prevents race conditions where INCR succeeds but EXPIRE fails.
 * Falls back to pipeline (non-atomic) if Lua is not available.
 */
async function incrementAtomic(keys: string[]): Promise<number[]> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash not configured");
  }

  const baseUrl = url.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Try Lua script first (atomic INCR + EXPIRE)
  const luaScript = `
    local results = {}
    for i = 1, #KEYS do
      local count = redis.call("INCR", KEYS[i])
      redis.call("EXPIRE", KEYS[i], 172800)
      table.insert(results, count)
    end
    return results
  `;

  const response = await fetch(`${baseUrl}/eval`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      script: luaScript,
      keys,
      args: [],
    }),
  });

  if (response.ok) {
    const data = (await response.json()) as { result?: number[] };
    if (data.result && data.result.length === keys.length) {
      return data.result.map((n) => Number(n));
    }
  }

  // Fallback: pipeline (non-atomic but better than nothing)
  const commands = keys.flatMap((key) => [
    ["INCR", key],
    ["EXPIRE", key, "172800"],
  ]);
  const pipeResponse = await fetch(`${baseUrl}/pipeline`, {
    method: "POST",
    headers,
    body: JSON.stringify(commands),
  });
  if (!pipeResponse.ok) throw new Error(`Upstash ${pipeResponse.status}`);
  const results = (await pipeResponse.json()) as Array<{ result?: number }>;
  return keys.map((_, index) => Number(results[index * 2]?.result ?? 0));
}