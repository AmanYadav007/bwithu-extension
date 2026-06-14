// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

export function collectPageContext() {
  const title = document.title ? `Title: ${document.title}` : "";
  const url = `URL: ${window.location.href}`;
  
  // 1. Meta Description
  const metaDescEl = document.querySelector('meta[name="description"]');
  const metaDesc = metaDescEl ? `Meta Description: ${metaDescEl.getAttribute("content")?.trim()}` : "";

  // 2. Selected Text
  const selection = window.getSelection()?.toString().trim();
  const selectedText = selection ? `Selected text: ${selection}` : "";

  // 3. Headings
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((heading) => heading.textContent?.trim())
    .filter(Boolean)
    .slice(0, 15)
    .join("\n");

  // 4. Clean Page Body text
  let bodyText = "";
  if (document.body) {
    const clone = document.body.cloneNode(true) as HTMLElement;
    // Remove scripts, styles, header, footer, nav elements to get clean article/page context
    const tagsToRemove = ["script", "style", "noscript", "iframe", "svg", "nav", "header", "footer"];
    tagsToRemove.forEach((tag) => {
      clone.querySelectorAll(tag).forEach((el) => el.remove());
    });
    
    // Check if there's a main or article element to prioritize
    const mainContentEl = clone.querySelector("article, main") as HTMLElement | null;
    const textNode = (mainContentEl ? mainContentEl : clone) as HTMLElement;
    
    bodyText = textNode.innerText || "";
  }
  
  // Deduplicate consecutive blank lines, clean formatting
  bodyText = bodyText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // deduplicate consecutive identical lines (e.g. repeated navigation UI links)
    .filter((line, idx, arr) => line !== arr[idx - 1])
    .join("\n");

  // 5. Scroll Position & Height
  const scrollY = window.scrollY || window.pageYOffset || 0;
  const totalHeight = document.documentElement.scrollHeight || 0;
  const viewportHeight = window.innerHeight || 0;
  const scrollPercent = totalHeight > viewportHeight ? Math.round((scrollY / (totalHeight - viewportHeight)) * 100) : 100;
  const scrollStatus = `Scroll Position: ${Math.round(scrollY)}px (${scrollPercent}% scrolled, page height is ${totalHeight}px)`;

  return [
    title,
    url,
    metaDesc,
    selectedText,
    headings ? `Headings:\n${headings}` : "",
    `Page content (cleaned):\n${bodyText.slice(0, 15000)}`,
    scrollStatus
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function getActivePageContext(): Promise<string> {
  try {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.sendMessage) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab?.id) {
        const context = await chrome.tabs.sendMessage(activeTab.id, { type: "BWITHU_COLLECT_PAGE_CONTEXT" });
        return String(context);
      }
    }
  } catch (err) {
    console.warn("BWithU could not retrieve context from active page tab:", err);
  }

  // Fallback to local parsing (e.g. content script or local web server)
  if (typeof document !== "undefined" && document.body) {
    return collectPageContext();
  }
  return "";
}
