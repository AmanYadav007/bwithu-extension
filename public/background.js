// Toggle BwithU visibility when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  chrome.tabs.sendMessage(tab.id, { toggle: true });
});
