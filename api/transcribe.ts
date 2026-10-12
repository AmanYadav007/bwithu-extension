import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guard } from "./_guard";
import { getCorsConfig, handlePreflight, applyCorsHeaders, enforceRequestSize, validateJsonBody } from "./_cors";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB for audio

interface TranscribeRequest {
  audio: number[];
  mimeType: string;
}

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/wav",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsConfig = getCorsConfig();
  const origin = String(req.headers.origin || "");

  if (handlePreflight(req, res, corsConfig)) return;
  applyCorsHeaders(res, corsConfig, origin);

  const { body, error } = await enforceRequestSize<TranscribeRequest>(req, MAX_BODY_BYTES, req.body);
  if (error) return res.status(413).json({ error });
  if (!body) return res.status(400).json({ error: "Invalid request body." });

  if (!(await guard(req, res, "transcribe"))) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "xAI API key not configured on BWithU proxy server." });
  }

  const validatedBody = validateJsonBody<TranscribeRequest>(body, (b): b is TranscribeRequest => {
    if (!b || typeof b !== "object") return false;
    return Array.isArray(b.audio) && typeof b.mimeType === "string" && ALLOWED_MIME_TYPES.has(b.mimeType);
  });

  if (!validatedBody) {
    return res.status(400).json({ error: "Missing or invalid audio array or unsupported mimeType." });
  }

  if (validatedBody.audio.length === 0 || validatedBody.audio.length > MAX_BODY_BYTES) {
    return res.status(400).json({ error: "Audio data size invalid (max 5 MB)." });
  }

  try {
    const formData = new FormData();
    const filename = validatedBody.mimeType.includes("mpeg")
      ? "recording.mp3"
      : validatedBody.mimeType.includes("ogg")
        ? "recording.ogg"
        : validatedBody.mimeType.includes("mp4")
          ? "recording.mp4"
          : validatedBody.mimeType.includes("wav")
            ? "recording.wav"
            : "recording.webm";

    const blob = new Blob([new Uint8Array(validatedBody.audio)], { type: validatedBody.mimeType });
    formData.append("file", blob, filename);

    const response = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res
        .status(response.status)
        .json({ error: `xAI STT Error: ${errorText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Internal Proxy Failure during STT";
    return res.status(500).json({ error: message });
  }
}