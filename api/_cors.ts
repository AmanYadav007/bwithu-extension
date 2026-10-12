import type { VercelRequest, VercelResponse } from "@vercel/node";

export interface CorsConfig {
  allowedOrigins: string[];
  allowCredentials: boolean;
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAge: number;
}

const DEFAULT_CONFIG: CorsConfig = {
  allowedOrigins: [],
  allowCredentials: false,
  allowedMethods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-BwithU-Install"],
  maxAge: 86400,
};

function parseAllowedOrigins(envValue: string): string[] {
  return envValue
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function getCorsConfig(): CorsConfig {
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || "");
  return { ...DEFAULT_CONFIG, allowedOrigins };
}

export function isOriginAllowed(origin: string, config: CorsConfig): boolean {
  if (config.allowedOrigins.length === 0) return false;
  return config.allowedOrigins.includes(origin);
}

export function applyCorsHeaders(res: VercelResponse, config: CorsConfig, origin: string): void {
  const isAllowed = isOriginAllowed(origin, config);

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    if (config.allowCredentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  } else if (config.allowedOrigins.length === 0) {
    // No allowlist configured — do not set any CORS headers.
    // This rejects browser requests by default (secure by default).
  }

  res.setHeader("Access-Control-Allow-Methods", config.allowedMethods.join(", "));
  res.setHeader("Access-Control-Allow-Headers", config.allowedHeaders.join(", "));
  res.setHeader("Access-Control-Max-Age", String(config.maxAge));
  res.setHeader("Vary", "Origin");
}

export function handlePreflight(
  req: VercelRequest,
  res: VercelResponse,
  config: CorsConfig,
): boolean {
  if (req.method !== "OPTIONS") return false;

  const origin = String(req.headers.origin || "");
  applyCorsHeaders(res, config, origin);
  res.status(204).end();
  return true;
}

export function corsMiddleware(config: CorsConfig = getCorsConfig()) {
  return async (req: VercelRequest, res: VercelResponse): Promise<boolean> => {
    const origin = String(req.headers.origin || "");

    if (handlePreflight(req, res, config)) return false;

    applyCorsHeaders(res, config, origin);

    if (config.allowedOrigins.length > 0 && origin && !isOriginAllowed(origin, config)) {
      res.status(403).json({ error: "Origin not allowed." });
      return false;
    }

    return true;
  };
}

/**
 * Validates request size by checking Content-Length header first (fast path),
 * then enforces actual body size by reading the stream.
 * If body is already provided (e.g., from dev-proxy), validates its size directly.
 * Returns the parsed body if valid, or null if oversized/invalid.
 * Note: This consumes the request body stream on Vercel.
 */
export async function enforceRequestSize<T>(
  req: VercelRequest,
  maxBytes: number,
  preParsedBody?: unknown
): Promise<{ body: T | null; error: string | null }> {
  // If body is already parsed (dev-proxy), validate its serialized size
  if (preParsedBody !== undefined) {
    const serialized = JSON.stringify(preParsedBody);
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
      return { body: null, error: "Request body too large." };
    }
    return { body: preParsedBody as T, error: null };
  }

  // Vercel: read from stream
  // Fast path: reject obviously oversized requests via Content-Length
  const contentLength = req.headers["content-length"];
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return { body: null, error: "Request body too large." };
  }

  // Read actual body to enforce limit
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        return { body: null, error: "Request body too large." };
      }
      chunks.push(buffer);
    }
  } catch {
    // Not an async iterable (e.g., dev-proxy without pre-parsed body)
    return { body: null, error: "Request body too large." };
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return { body: null, error: null };

  try {
    return { body: JSON.parse(raw) as T, error: null };
  } catch {
    return { body: null, error: "Invalid JSON body." };
  }
}

/**
 * Validates JSON body against a type guard.
 * Use after enforceRequestSize to avoid double-parsing.
 */
export function validateJsonBody<T>(body: unknown, validator: (body: unknown) => body is T): T | null {
  try {
    return validator(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Production origin policy helper.
 * In production (BWITHU_PUBLIC=1 or Vercel), requires explicit ALLOWED_ORIGINS.
 * In development, allows all origins but logs a warning if unconfigured.
 */
export function getOriginPolicy(): { requireAllowlist: boolean; allowEmptyInDev: boolean } {
  const isProduction = process.env.BWITHU_PUBLIC === "1" || process.env.VERCEL === "1";
  return {
    requireAllowlist: isProduction,
    allowEmptyInDev: !isProduction,
  };
}