import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "xAI API key not configured on BWithU proxy server." });
  }

  try {
    const { text, voiceId } = req.body as { text: string; voiceId: string };
    if (!text) {
      return res.status(400).json({ error: "Missing text parameter." });
    }

    const response = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId || "ara",
        language: "auto",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `xAI TTS Error: ${errorText}` });
    }

    const contentType = response.headers.get("Content-Type") || "audio/mpeg";
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));

    return res.status(200).json({ bytes, mimeType: contentType });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Proxy Failure during TTS";
    return res.status(500).json({ error: message });
  }
}
