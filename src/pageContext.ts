export function collectPageContext() {
  const title = document.title ? `Title: ${document.title}` : "";
  const url = `URL: ${window.location.href}`;
  const selection = window.getSelection()?.toString().trim();
  const selectedText = selection ? `Selected text: ${selection}` : "";
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((heading) => heading.textContent?.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join("\n");
  const body = document.body?.innerText?.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim() ?? "";

  return [title, url, selectedText, headings ? `Headings:\n${headings}` : "", `Visible page text:\n${body.slice(0, 12000)}`]
    .filter(Boolean)
    .join("\n\n");
}
