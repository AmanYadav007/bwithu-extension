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
    const { audio, mimeType } = req.body as { audio: number[]; mimeType: string };
    if (!audio || !Array.isArray(audio)) {
      return res.status(400).json({ error: "Missing audio array in request body." });
    }

    const buffer = Buffer.from(audio);
    const formData = new FormData();
    const filename = mimeType.includes("mpeg")
      ? "recording.mp3"
      : mimeType.includes("ogg")
        ? "recording.ogg"
        : "recording.webm";

    const blob = new Blob([buffer], { type: mimeType });
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
      return res.status(response.status).json({ error: `xAI STT Error: ${errorText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Proxy Failure during STT";
    return res.status(500).json({ error: message });
  }
}
