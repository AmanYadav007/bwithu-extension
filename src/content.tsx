import browser from "webextension-polyfill";
import { collectPageContext } from "./pageContext";

browser.runtime.onMessage.addListener((request: unknown) => {
  if (
    request !== null &&
    typeof request === "object" &&
    "type" in request &&
    (request as { type?: string }).type === "BWITHU_COLLECT_PAGE_CONTEXT"
  ) {
    return Promise.resolve(collectPageContext());
  }
});
