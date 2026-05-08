import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import browser from "webextension-polyfill";

// Inject BwithU root element
const root = document.createElement('div');
root.id = 'bwithu-root';
document.body.appendChild(root);

// Listen for toggle messages from background script
if (typeof browser !== 'undefined' && browser.runtime) {
  browser.runtime.onMessage.addListener((request: any) => {
    if (request.toggle) {
      const bwithuRoot = document.getElementById('bwithu-root');
      if (bwithuRoot) {
        bwithuRoot.style.display = bwithuRoot.style.display === 'none' ? 'block' : 'none';
      }
    }
  });
}

// Mount React app
ReactDOM.createRoot(root).render(<App />);
