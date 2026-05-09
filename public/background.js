chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { toggle: true });
  } catch {
    // Content script not loaded on this page (e.g. chrome:// URLs) — do nothing.
  }
});
