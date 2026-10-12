import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guard } from "./_guard";
import { getCorsConfig, handlePreflight, applyCorsHeaders, enforceRequestSize } from "./_cors";

const MAX_BODY_BYTES = 1 * 1024; // 1 KB

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsConfig = getCorsConfig();
  const origin = String(req.headers.origin || "");

  if (handlePreflight(req, res, corsConfig)) return;
  applyCorsHeaders(res, corsConfig, origin);

  const { body, error } = await enforceRequestSize(req, MAX_BODY_BYTES, req.body);
  if (error) return res.status(413).json({ error });
  // body can be empty for realtime-secret

  if (!(await guard(req, res, "voice"))) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "xAI API key not configured on BWithU proxy server." });
  }

  try {
    const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `xAI Realtime Secret Error: ${errorText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Proxy Failure during realtime secret fetching";
    return res.status(500).json({ error: message });
  }
}