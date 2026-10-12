import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guard } from "./_guard";
import { getCorsConfig, handlePreflight, applyCorsHeaders, enforceRequestSize, validateJsonBody } from "./_cors";

const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const ALLOWED_MODELS = new Set(["grok-4.3", "grok-4-fast-non-reasoning", "grok-3-mini"]);

interface ChatRequest {
  model?: string;
  max_tokens?: number;
  messages?: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsConfig = getCorsConfig();
  const origin = String(req.headers.origin || "");

  if (handlePreflight(req, res, corsConfig)) return;
  applyCorsHeaders(res, corsConfig, origin);

  const { body, error } = await enforceRequestSize<ChatRequest>(req, MAX_BODY_BYTES, req.body);
  if (error) return res.status(413).json({ error });
  if (!body) return res.status(400).json({ error: "Invalid request body." });

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

  const validatedBody = validateJsonBody<ChatRequest>(body, (b): b is ChatRequest => {
    if (!b || typeof b !== "object") return false;
    const msg = b.messages;
    return !msg || Array.isArray(msg);
  });

  if (!validatedBody) {
    return res.status(400).json({ error: "Invalid request body." });
  }

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sanitizeChatBody(validatedBody)),
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

function sanitizeChatBody(body: ChatRequest) {
  const model = typeof body.model === "string" && ALLOWED_MODELS.has(body.model) ? body.model : "grok-4.3";
  const maxTokens = Math.min(Number(body.max_tokens) || 700, 900);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  return { ...body, model, max_tokens: maxTokens, messages, stream: false, n: 1 };
}