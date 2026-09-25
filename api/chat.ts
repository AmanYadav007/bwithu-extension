import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guard } from "./_guard";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (!(await guard(req, res, "chat"))) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "xAI API key not configured on BWithU proxy server." });
  }

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sanitizeChatBody(req.body)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res
        .status(response.status)
        .json({ error: `xAI API Error: ${errorText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal Proxy Failure";
    return res.status(500).json({ error: message });
  }
}

const ALLOWED_MODELS = new Set(["grok-4.3", "grok-4-fast-non-reasoning", "grok-3-mini"]);

// Don't let the public proxy be used as a free, unlimited Grok endpoint.
function sanitizeChatBody(body: Record<string, unknown> = {}) {
  const model = typeof body.model === "string" && ALLOWED_MODELS.has(body.model) ? body.model : "grok-4.3";
  const maxTokens = Math.min(Number(body.max_tokens) || 700, 900);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  return { ...body, model, max_tokens: maxTokens, messages, stream: false, n: 1 };
}
