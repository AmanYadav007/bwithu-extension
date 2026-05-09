import ReactDOM from "react-dom/client";
import browser from "webextension-polyfill";
import App from "./App";
import "./index.css";

const root = document.createElement("div");
root.id = "bwithu-root";
document.body.appendChild(root);

let visible = true;

browser.runtime.onMessage.addListener((request: unknown) => {
  if (
    request !== null &&
    typeof request === "object" &&
    "toggle" in request &&
    (request as { toggle: boolean }).toggle
  ) {
    visible = !visible;
    root.style.visibility = visible ? "visible" : "hidden";
  }
});

ReactDOM.createRoot(root).render(<App />);
