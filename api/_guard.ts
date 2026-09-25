import type { VercelRequest, VercelResponse } from "@vercel/node";

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
 * - ALLOWED_ORIGINS (optional, comma-separated), e.g. "chrome-extension://<extension-id>".
 * - Daily quotas per install id (X-BwithU-Install header) and per IP. Stored in Upstash Redis
 *   when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set (global across instances),
 *   otherwise in memory per warm instance (fine for testing only).
 */
export async function guard(req: VercelRequest, res: VercelResponse, bucket: QuotaBucket): Promise<boolean> {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = String(req.headers.origin || "");
  if (allowed.length > 0 && origin && !allowed.includes(origin)) {
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
    counts = await increment(keys);
  } catch (error) {
    // Never take the product down because the quota store hiccuped.
    console.error("Quota store failed", error);
    return true;
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

async function increment(keys: string[]): Promise<number[]> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return keys.map((key) => {
      const next = (memoryCounts.get(key) ?? 0) + 1;
      memoryCounts.set(key, next);
      return next;
    });
  }

  const commands = keys.flatMap((key) => [
    ["INCR", key],
    ["EXPIRE", key, "172800"],
  ]);
  const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`Upstash ${response.status}`);
  const results = (await response.json()) as Array<{ result?: number }>;
  return keys.map((_, index) => Number(results[index * 2]?.result ?? 0));
}
