import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guard } from "./_guard";
import { getCorsConfig, handlePreflight, applyCorsHeaders, validateRequestSize, validateJsonBody } from "./_cors";

const MAX_BODY_BYTES = 32 * 1024; // 32 KB (text + voiceId)
const XAI_VOICES = new Set(["ara", "eve", "rex", "sal", "leo"]);

interface SpeakRequest {
  text: string;
  voiceId?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsConfig = getCorsConfig();
  const origin = String(req.headers.origin || "");

  if (handlePreflight(req, res, corsConfig)) return;
  applyCorsHeaders(res, corsConfig, origin);

  if (!validateRequestSize(req, MAX_BODY_BYTES)) {
    return res.status(413).json({ error: "Request body too large." });
  }

  if (!(await guard(req, res, "speak"))) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "xAI API key not configured on BWithU proxy server." });
  }

  const body = validateJsonBody<SpeakRequest>(req.body, (b): b is SpeakRequest => {
    if (!b || typeof b !== "object") return false;
    return typeof b.text === "string" && b.text.length > 0 && b.text.length <= 5000;
  });

  if (!body) {
    return res.status(400).json({ error: "Missing or invalid text parameter (max 5000 chars)." });
  }

  const voice = XAI_VOICES.has(String(body.voiceId || "").toLowerCase())
    ? String(body.voiceId).toLowerCase()
    : "ara";

  try {
    const response = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: body.text.slice(0, 1200),
        voice_id: voice,
        language: "auto",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res
        .status(response.status)
        .json({ error: `xAI TTS Error: ${errorText}` });
    }

    const contentType = response.headers.get("Content-Type") || "audio/mpeg";
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));

    return res.status(200).json({ bytes, mimeType: contentType });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Internal Proxy Failure during TTS";
    return res.status(500).json({ error: message });
  }
}