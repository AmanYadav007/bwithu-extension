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

export function validateRequestSize(req: VercelRequest, maxBytes: number): boolean {
  const contentLength = req.headers["content-length"];
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return false;
  }
  return true;
}

export function validateJsonBody<T>(body: unknown, validator: (body: unknown) => body is T): T | null {
  try {
    return validator(body) ? body : null;
  } catch {
    return null;
  }
}