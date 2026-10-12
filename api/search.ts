import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guard } from "./_guard";
import { getCorsConfig, handlePreflight, applyCorsHeaders, validateRequestSize, validateJsonBody } from "./_cors";

const MAX_BODY_BYTES = 4 * 1024; // 4 KB for query

interface SearchRequest {
  query: string;
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsConfig = getCorsConfig();
  const origin = String(req.headers.origin || "");

  if (handlePreflight(req, res, corsConfig)) return;
  applyCorsHeaders(res, corsConfig, origin);

  if (!validateRequestSize(req, MAX_BODY_BYTES)) {
    return res.status(413).json({ error: "Request body too large." });
  }

  if (!(await guard(req, res, "search"))) return;

  const query = req.method === "POST"
    ? validateJsonBody<SearchRequest>(req.body, (b): b is SearchRequest =>
        !!b && typeof b === "object" && typeof b.query === "string" && b.query.length > 0 && b.query.length <= 500
      )?.query
    : (req.query?.query as string | undefined);

  if (!query || query.length > 500) {
    return res.status(400).json({ error: "Missing or invalid query parameter (max 500 chars)." });
  }

  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;

  if (braveApiKey) {
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", "5");
      url.searchParams.set("country", "us");
      url.searchParams.set("search_lang", "en");
      url.searchParams.set("safesearch", "moderate");
      url.searchParams.set("spellcheck", "1");
      url.searchParams.set("extra_snippets", "1");

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": braveApiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `Brave Search Error: ${errorText}` });
      }

      const data = await response.json();
      return res.status(200).json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal Proxy Failure during Brave Search";
      return res.status(500).json({ error: message });
    }
  }

  // Tavily has a free tier (1,000 searches/month) and works from serverless IPs.
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (tavilyApiKey) {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${tavilyApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, max_results: 5, search_depth: "basic" }),
      });
      if (response.ok) {
        const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
        const results = (data.results ?? []).map((result) => ({
          title: result.title ?? "",
          url: result.url ?? "",
          description: (result.content ?? "").slice(0, 450),
        }));
        return res.status(200).json({ web: { results } });
      }
    } catch {
      // fall through to DuckDuckGo
    }
  }

  // Last resort: DuckDuckGo HTML scrape (free, but often 403s from Vercel IPs).
  try {
    const results = await scrapeDuckDuckGo(query);
    return res.status(200).json({ web: { results } });
  } catch {
    // Return empty results rather than an error so B can still answer from what it knows.
    return res.status(200).json({ web: { results: [] } });
  }
}

async function scrapeDuckDuckGo(query: string): Promise<SearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML search returned status ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  const resultBlocks = html.split('class="result__body"');
  for (let i = 1; i < resultBlocks.length && results.length < 5; i++) {
    const block = resultBlocks[i];

    const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    if (urlMatch) {
      let url = urlMatch[1];
      if (url.includes("uddg=")) {
        try {
          const searchParams = new URLSearchParams(url.split("?")[1]);
          url = searchParams.get("uddg") || url;
        } catch {
          // ignore parsing errors
        }
      }

      const title = stripHtmlTags(urlMatch[2]);
      const description = snippetMatch ? stripHtmlTags(snippetMatch[1]) : "";

      if (title && url) {
        results.push({
          title: title.trim(),
          url: url.trim(),
          description: description.trim().slice(0, 450),
        });
      }
    }
  }

  return results;
}

function stripHtmlTags(text: string) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}