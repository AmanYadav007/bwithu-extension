interface ChromeTab {
  id?: number;
}

interface ChromeActionApi {
  onClicked: {
    addListener: (callback: (tab: ChromeTab) => void | Promise<void>) => void;
  };
}

interface ChromeTabsApi {
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

interface ChromeExtensionApi {
  action: ChromeActionApi;
  tabs: ChromeTabsApi;
}

const chromeApi = (globalThis as unknown as { chrome: ChromeExtensionApi }).chrome;

chromeApi.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    await chromeApi.tabs.sendMessage(tab.id, { type: "BWITHU_TOGGLE" });
  } catch {
    // Content scripts do not run on restricted pages like chrome:// URLs.
  }
});
