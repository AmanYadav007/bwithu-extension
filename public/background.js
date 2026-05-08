// Toggle BwithU visibility when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { toggle: true });
  } catch (error) {
    console.log('Content script not loaded yet, reloading page...');
    // Content script might not be loaded, reload the tab
    chrome.tabs.reload(tab.id);
  }
});
