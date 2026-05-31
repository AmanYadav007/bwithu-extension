import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const query = req.method === "POST" ? req.body?.query : req.query?.query;
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter." });
  }

  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;

  if (braveApiKey) {
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", String(query));
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
  } else {
    // Fall back to DuckDuckGo Scraper (100% Free, No API Keys)
    try {
      const results = await scrapeDuckDuckGo(String(query));
      return res.status(200).json({
        web: {
          results: results,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "DuckDuckGo Scraper failed";
      return res.status(500).json({ error: `Web search failed: ${message}` });
    }
  }
}

async function scrapeDuckDuckGo(query: string) {
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
  const results: Array<{ title: string; url: string; description: string }> = [];

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
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
