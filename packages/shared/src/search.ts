import type { BwithuSettings } from "./types";
import { DEFAULT_PROXY_URL, stripHtml } from "./utils";
import { proxyError, proxyHeaders } from "./storage";

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

export async function braveSearch(query: string, settings: BwithuSettings): Promise<BraveSearchResult[]> {
  if (settings.braveApiKey) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "5");
    url.searchParams.set("country", "us");
    url.searchParams.set("search_lang", "en");
    url.searchParams.set("safesearch", "moderate");
    url.searchParams.set("spellcheck", "1");
    url.searchParams.set("extra_snippets", "1");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": settings.braveApiKey,
      },
    });

    if (!response.ok) throw new Error(`Brave Search could not look that up (${response.status}).`);
    const data = (await response.json()) as {
      web?: {
          results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          extra_snippets?: string[];
          age?: string;
        }>;
      };
    };

    return (data.web?.results ?? [])
      .filter((result) => result.title && result.url)
      .slice(0, 5)
      .map((result) => ({
        title: stripHtml(result.title ?? "Untitled"),
        url: result.url ?? "",
        description: stripHtml([result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(" ")).slice(0, 900),
        age: result.age,
      }));
  } else {
    // Always the proxy: getApiEndpoint would return Brave's URL when an xAI key is set.
    const proxyUrl = `${(settings.proxyUrl || DEFAULT_PROXY_URL).replace(/\/$/, "")}/api/search`;
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: await proxyHeaders(),
      body: JSON.stringify({ query }),
    });

    if (!response.ok) throw await proxyError(response, "Search could not look that up via proxy");
    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          extra_snippets?: string[];
          age?: string;
        }>;
      };
    };

    return (data.web?.results ?? [])
      .filter((result) => result.title && result.url)
      .slice(0, 5)
      .map((result) => ({
        title: stripHtml(result.title ?? "Untitled"),
        url: result.url ?? "",
        description: stripHtml([result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(" ")).slice(0, 900),
        age: result.age,
      }));
  }
}

export async function collectWebContext(query: string, settings: BwithuSettings) {
  try {
    const results = await braveSearch(query, settings);
    if (results.length === 0) return `Web search for "${query}" returned no useful results.`;
    return [
      `Fresh web search results for "${query}":`,
      ...results.map((result, index) => {
        const age = result.age ? ` (${result.age})` : "";
        return `${index + 1}. ${result.title}${age}\n${result.url}\n${result.description}`;
      }),
    ].join("\n\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Brave Search failed.";
    return `Web search requested for "${query}", but Brave Search failed: ${message}`;
  }
}
