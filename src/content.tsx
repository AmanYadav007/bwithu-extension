import ReactDOM from "react-dom/client";
import browser from "webextension-polyfill";
import App from "./App";
import "./index.css";

const root = document.createElement("div");
root.id = "bwithu-root";
document.documentElement.appendChild(root);

let visible = false;
const reactRoot = ReactDOM.createRoot(root);

function render() {
  reactRoot.render(<App enabled={visible} />);
}

browser.runtime.onMessage.addListener((request: unknown) => {
  if (
    request !== null &&
    typeof request === "object" &&
    "type" in request &&
    (request as { type?: string }).type === "BWITHU_TOGGLE"
  ) {
    visible = !visible;
    render();
  }
});

render();
