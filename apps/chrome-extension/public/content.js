// Inject BwithU root element
const root = document.createElement('div');
root.id = 'bwithu-root';
document.body.appendChild(root);

// Inject styles
const style = document.createElement('style');
style.textContent = `
  #bwithu-root {
    position: fixed;
    bottom: 40px;
    right: 40px;
    z-index: 999999;
    pointer-events: auto;
  }
`;
document.head.appendChild(style);

// Listen for toggle messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.toggle) {
    const bwithuRoot = document.getElementById('bwithu-root');
    if (bwithuRoot) {
      bwithuRoot.style.display = bwithuRoot.style.display === 'none' ? 'block' : 'none';
    }
  }
});
