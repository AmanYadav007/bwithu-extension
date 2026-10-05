import { createLiveOrb } from "@bwithu/ui/live-orb-engine";
import type { LiveOrbGaze, LiveOrbInstance } from "@bwithu/ui/live-orb-engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const SETTINGS_KEY = "bwithu.settings";
const LIVE_STATE_KEY = "bwithu.liveState";
const SIZE = 64;

const HALO: Record<string, string> = {
  listen: "rgba(125, 211, 252, 0.85)",
  think: "rgba(196, 181, 253, 0.8)",
  searching: "rgba(196, 181, 253, 0.8)",
  talk: "rgba(253, 230, 138, 0.85)",
};

const GAZE: Record<string, LiveOrbGaze> = {
  think: { x: 0.55, y: 0.6 },
  searching: { x: 0.55, y: 0.6 },
  listen: { x: -0.2, y: 0.1 },
  talk: { x: -0.2, y: 0.05 },
};

const STYLE = `
  :host { all: initial; }
  .wrap {
    position: fixed; right: 20px; bottom: 20px; width: ${SIZE}px; height: ${SIZE}px;
    z-index: 2147483646; cursor: pointer; transition: transform 180ms ease;
    filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.28));
    animation: bwithu-float 4s ease-in-out infinite;
  }
  .wrap:hover { transform: scale(1.12); }
  .wrap.talk { animation: bwithu-talk 0.42s ease-in-out infinite; }
  .halo {
    position: absolute; inset: -14px; border-radius: 50%; opacity: 0; pointer-events: none;
    transition: opacity 250ms ease; animation: bwithu-pulse 1.6s ease-in-out infinite;
  }
  .orb { position: absolute; inset: 1px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 1px rgba(9, 9, 11, 0.12); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .close {
    position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%;
    border: none; background: #18181b; color: #fafafa; font: 600 12px/20px system-ui, sans-serif;
    text-align: center; padding: 0; cursor: pointer; opacity: 0; transition: opacity 150ms ease;
  }
  .wrap:hover .close { opacity: 1; }
  .tip {
    position: absolute; right: ${SIZE + 10}px; top: 50%; transform: translateY(-50%);
    white-space: nowrap; background: #18181b; color: #fafafa; font: 500 12px system-ui, sans-serif;
    padding: 6px 10px; border-radius: 8px; opacity: 0; pointer-events: none; transition: opacity 150ms ease;
  }
  .wrap:hover .tip { opacity: 1; }
  @keyframes bwithu-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -5px; } }
  @keyframes bwithu-talk { 0%, 100% { translate: 0 0; scale: 1; } 50% { translate: 0 -3px; scale: 1.05; } }
  @keyframes bwithu-pulse { 0%, 100% { scale: 0.92; } 50% { scale: 1.05; } }
  @media (prefers-reduced-motion: reduce) { .wrap, .wrap.talk, .halo { animation: none; } }
`;

/** Small floating B on web pages: shows B's live state and opens the side panel on click. */
export function mountPageOrb() {
  if (window.top !== window || document.getElementById("bwithu-orb-host")) return;

  let host: HTMLDivElement | null = null;
  let orb: LiveOrbInstance | null = null;
  let wrap: HTMLDivElement | null = null;
  let halo: HTMLDivElement | null = null;
  let dismissed = false;

  const applyState = (state: string) => {
    if (!wrap || !halo) return;
    wrap.classList.toggle("talk", state === "talk");
    const color = HALO[state];
    halo.style.opacity = color ? "1" : "0";
    if (color) halo.style.background = `radial-gradient(circle, ${color} 0%, transparent 68%)`;
    orb?.setOptions({ gaze: GAZE[state] ?? null });
  };

  const mount = () => {
    if (host || dismissed || !document.body) return;
    host = document.createElement("div");
    host.id = "bwithu-orb-host";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap" role="button" tabindex="0" aria-label="Talk to B">
        <div class="halo"></div>
        <div class="orb"><canvas></canvas></div>
        <span class="tip">Talk to B</span>
        <button class="close" type="button" aria-label="Hide B on this page">×</button>
      </div>`;
    wrap = root.querySelector(".wrap");
    halo = root.querySelector(".halo");
    const canvas = root.querySelector("canvas") as HTMLCanvasElement;
    document.body.appendChild(host);
    orb = createLiveOrb(canvas, { variant: "white", trackRadius: 700, gazeLimit: 0.5 });

    wrap?.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).classList.contains("close")) return;
      orb?.blink();
      chrome.runtime.sendMessage({ type: "BWITHU_OPEN_PANEL" }).catch(() => {});
    });
    wrap?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") wrap?.click();
    });
    root.querySelector(".close")?.addEventListener("click", () => {
      dismissed = true;
      unmount();
    });

    chrome.storage.local.get(LIVE_STATE_KEY).then((stored: Record<string, string>) => applyState(stored[LIVE_STATE_KEY] ?? "idle"));
  };

  const unmount = () => {
    orb?.destroy();
    orb = null;
    host?.remove();
    host = null;
    wrap = null;
    halo = null;
  };

  const sync = (settings?: { floatingOrb?: boolean }) => {
    if (settings?.floatingOrb === false) unmount();
    else mount();
  };

  chrome.storage.local.get(SETTINGS_KEY).then((stored: Record<string, { floatingOrb?: boolean }>) => sync(stored[SETTINGS_KEY]));
  chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY]) sync(changes[SETTINGS_KEY].newValue as { floatingOrb?: boolean });
    if (changes[LIVE_STATE_KEY]) applyState(String(changes[LIVE_STATE_KEY].newValue ?? "idle"));
  });
}
