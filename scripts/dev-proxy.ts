// Local stand-in for the Vercel proxy: serves api/*.ts on http://localhost:8787 using keys
// from the repo-root .env. Run with `npm run dev:proxy`.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT) || 8787;

const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const ROUTES = ["chat", "realtime-secret", "search", "speak", "transcribe"];

type Handler = (req: unknown, res: unknown) => unknown;

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function vercelResponse(res: ServerResponse) {
  const wrapped = {
    status(code: number) {
      res.statusCode = code;
      return wrapped;
    },
    json(body: unknown) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
      return wrapped;
    },
    end() {
      res.end();
      return wrapped;
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value);
      return wrapped;
    },
  };
  return wrapped;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-BwithU-Install");

  const route = url.pathname.replace(/^\/api\//, "");
  if (!url.pathname.startsWith("/api/") || !ROUTES.includes(route)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const started = Date.now();
  try {
    const module = (await import(resolve(root, "api", `${route}.ts`))) as { default: Handler };
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const vercelReq = {
      method: req.method,
      headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress || "local" },
      query: Object.fromEntries(url.searchParams),
      body,
    };
    await module.default(vercelReq, vercelResponse(res));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Local proxy error" }));
    }
  }
  console.log(`${req.method} /api/${route} -> ${res.statusCode} (${Date.now() - started}ms)`);
})
  .on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Try: PORT=8788 npm run dev:proxy (and rebuild with that port).`);
      process.exit(1);
    }
    throw error;
  })
  .listen(PORT, () => {
  const keys = ["XAI_API_KEY", "TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "UPSTASH_REDIS_REST_URL"]
    .map((key) => `${key}=${process.env[key] ? "set" : "-"}`)
    .join(" ");
  console.log(`BwithU dev proxy on http://localhost:${PORT}  (${keys})`);
});
