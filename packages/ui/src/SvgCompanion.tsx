import { useEffect, useRef, useState } from "react";
import { SvgAnimationController } from "./svgCompanion/animationController";
import type { SvgCompanionState } from "./svgCompanion/animationController";

export type { SvgCompanionState };

/**
 * Artwork contract (see CHARACTER_ARTWORK_SPEC.md): the SVG must contain
 * groups addressable as `[data-bwithu-part="head"]` (or `#bwithu-head`),
 * `eyes`, and a neutral `mouth-idle`. Optional: `mouth-open`, `mouth-half`,
 * `mouth-smile`, `torso`, `brows`, `hair`.
 */
const REQUIRED_PARTS = ["head", "eyes", "mouth-idle"] as const;

export interface SvgCompanionProps {
  /** Resolved local asset path (chrome-extension:// or dev-server path). */
  src: string;
  state: SvgCompanionState;
  className?: string;
}

type LoadStatus = "loading" | "ready" | "missing";

const SVG_COMPANION_CSS = `
.bwithu-svg-companion { display: block; width: 100%; height: 100%; }
.bwithu-svg-companion [data-bwithu-part],
.bwithu-svg-companion [id^="bwithu-"] { transform-box: fill-box; transform-origin: center; }
.bwithu-svg-companion [data-bwithu-part="mouth-open"],
.bwithu-svg-companion [data-bwithu-part="mouth-half"],
.bwithu-svg-companion [data-bwithu-part="mouth-smile"],
.bwithu-svg-companion #bwithu-mouth-open,
.bwithu-svg-companion #bwithu-mouth-half,
.bwithu-svg-companion #bwithu-mouth-smile { display: none; }
.bwithu-mouth-open [data-bwithu-part="mouth-open"],
.bwithu-mouth-open #bwithu-mouth-open,
.bwithu-mouth-half [data-bwithu-part="mouth-half"],
.bwithu-mouth-half #bwithu-mouth-half,
.bwithu-mouth-smile [data-bwithu-part="mouth-smile"],
.bwithu-mouth-smile #bwithu-mouth-smile { display: block; }
@keyframes bwithu-kf-breathe { from { transform: translateY(0); } to { transform: translateY(0.9%); } }
.bwithu-svg-state-idle [data-bwithu-part="torso"],
.bwithu-svg-state-idle #bwithu-torso,
.bwithu-svg-state-listening [data-bwithu-part="torso"],
.bwithu-svg-state-listening #bwithu-torso,
.bwithu-svg-state-thinking [data-bwithu-part="torso"],
.bwithu-svg-state-thinking #bwithu-torso { animation: bwithu-kf-breathe 4.2s ease-in-out infinite alternate; }
@keyframes bwithu-kf-nod { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(1.4deg); } }
.bwithu-svg-state-listening [data-bwithu-part="head"],
.bwithu-svg-state-listening #bwithu-head { animation: bwithu-kf-nod 2.6s ease-in-out infinite; }
@keyframes bwithu-kf-gaze { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(1.1%); } }
.bwithu-svg-state-thinking [data-bwithu-part="eyes"],
.bwithu-svg-state-thinking #bwithu-eyes { animation: bwithu-kf-gaze 3.4s ease-in-out infinite; }
@keyframes bwithu-kf-speak { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(0.8deg); } }
.bwithu-svg-state-speaking [data-bwithu-part="head"],
.bwithu-svg-state-speaking #bwithu-head { animation: bwithu-kf-speak 1.1s ease-in-out infinite; }
@keyframes bwithu-kf-blink { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.06); } }
.bwithu-blink [data-bwithu-part="eyes"],
.bwithu-blink #bwithu-eyes { animation: bwithu-kf-blink 0.14s linear; }
@media (prefers-reduced-motion: reduce) {
  .bwithu-svg-companion [data-bwithu-part],
  .bwithu-svg-companion [id^="bwithu-"] { animation: none !important; }
}
.bwithu-svg-missing {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; width: 100%; height: 100%; box-sizing: border-box; padding: 24px;
  text-align: center; border: 1px dashed #64748b; border-radius: 12px; background: #f1f5f9;
}
.bwithu-svg-missing__title { font-size: 14px; font-weight: 600; color: #0f172a; }
.bwithu-svg-missing__detail { font-size: 12px; color: #334155; overflow-wrap: anywhere; }
.bwithu-svg-missing__detail code { padding: 1px 5px; border-radius: 4px; background: #e2e8f0; }
.bwithu-svg-missing__hint { font-size: 12px; color: #475569; }
`;

export default function SvgCompanion({ src, state, className }: SvgCompanionProps) {
  const hostRef = useRef<SVGSVGElement>(null);
  const controllerRef = useRef<SvgAnimationController | null>(null);
  const [loaded, setLoaded] = useState<{ src: string } | null>(null);
  const [failure, setFailure] = useState<{ src: string; message: string } | null>(null);

  // Status is derived from the last settled load, keyed by src: switching src
  // falls back to "loading" without an extra render pass.
  const status: LoadStatus = failure?.src === src ? "missing" : loaded?.src === src ? "ready" : "loading";
  const error = status === "missing" ? (failure?.message ?? null) : null;

  // Load and inline the artwork once per src. The controller never owns these nodes.
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    if (hostRef.current) hostRef.current.innerHTML = ""; // DOM reset on src switch

    fetch(src, { signal: abort.signal, cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
        if (parsed.querySelector("parsererror")) throw new Error("invalid SVG markup");
        const artwork = parsed.documentElement;
        if (!artwork || artwork.localName !== "svg") throw new Error("asset root is not <svg>");
        for (const part of REQUIRED_PARTS) {
          if (!artwork.querySelector(`[data-bwithu-part="${part}"], #bwithu-${part}`)) {
            throw new Error(`missing required part "${part}"`);
          }
        }
        if (cancelled || !hostRef.current) return;
        const host = hostRef.current;
        const viewBox = artwork.getAttribute("viewBox");
        host.innerHTML = "";
        if (viewBox) host.setAttribute("viewBox", viewBox);
        for (const node of Array.from(artwork.childNodes)) {
          host.appendChild(document.importNode(node, true));
        }
        setLoaded({ src });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[SvgCompanion] artwork load failed:", err);
        setFailure({ src, message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [src]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "ready") return;
    if (!controllerRef.current) controllerRef.current = new SvgAnimationController(host);
    controllerRef.current.applyState(state);
  }, [state, status]);

  useEffect(
    () => () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    },
    [],
  );

  if (status === "missing") {
    return (
      <div className={`bwithu-svg-missing ${className ?? ""}`} role="img" aria-label="Character artwork missing">
        <style>{SVG_COMPANION_CSS}</style>
        <span className="bwithu-svg-missing__title">Character artwork missing</span>
        <span className="bwithu-svg-missing__detail">
          Expected at <code>{src}</code>
          {error ? ` — ${error}` : ""}
        </span>
        <span className="bwithu-svg-missing__hint">
          Drop a layered SVG there — see packages/ui/CHARACTER_ARTWORK_SPEC.md
        </span>
      </div>
    );
  }

  return (
    <>
      <style>{SVG_COMPANION_CSS}</style>
      <svg
        ref={hostRef}
        className={`bwithu-svg-companion ${className ?? ""}`}
        role="img"
        aria-label="BwithU companion character"
        preserveAspectRatio="xMidYMid meet"
      />
    </>
  );
}
