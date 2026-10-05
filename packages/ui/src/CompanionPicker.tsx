import { useEffect, useState } from "react";
import type { CompanionAvatar } from "@bwithu/shared";
import PixelCompanion from "./PixelCompanion";
import { PIXEL_COMPANIONS } from "./pixelCompanions";

interface CompanionPickerProps {
  onChoose: (avatar: CompanionAvatar) => void;
}

const CHOICES: CompanionAvatar[] = ["male", "female"];

/** First-run character select: pick a ready-made companion (custom photo companions come later). */
export default function CompanionPicker({ onChoose }: CompanionPickerProps) {
  const [selected, setSelected] = useState<CompanionAvatar | null>(null);
  // The picked companion does a little happy reaction.
  const [cheering, setCheering] = useState<CompanionAvatar | null>(null);

  useEffect(() => {
    if (!cheering) return undefined;
    const timer = setTimeout(() => setCheering(null), 1600);
    return () => clearTimeout(timer);
  }, [cheering]);

  return (
    <div className="bwithu-picker">
      <header className="bwithu-picker__header">
        <span className="bwithu-picker__eyebrow">BwithU</span>
        <h1>Choose your companion</h1>
        <p>Who would you like to talk to?</p>
      </header>

      <div className="bwithu-picker__grid" role="radiogroup" aria-label="Companion">
        {CHOICES.map((avatar) => {
          const spec = PIXEL_COMPANIONS[avatar];
          const isSelected = selected === avatar;
          return (
            <button
              key={avatar}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`bwithu-picker__card${isSelected ? " bwithu-picker__card--selected" : ""}`}
              onClick={() => {
                setSelected(avatar);
                setCheering(avatar);
              }}
            >
              <span className="bwithu-picker__portrait" style={{ background: spec.cardColor }}>
                <PixelCompanion avatar={avatar} state={cheering === avatar ? "happy" : "idle"} scale={3} />
              </span>
              <span className="bwithu-picker__label">{spec.label}</span>
            </button>
          );
        })}

        <button type="button" className="bwithu-picker__card bwithu-picker__card--custom" disabled>
          <span className="bwithu-picker__plus" aria-hidden="true">+</span>
          <span className="bwithu-picker__custom-text">
            <span className="bwithu-picker__label">Custom</span>
            <span>Turn a photo of someone you love into a pixel companion</span>
          </span>
          <span className="bwithu-picker__badge">Soon</span>
        </button>
      </div>

      <button
        type="button"
        className="bwithu-picker__start"
        disabled={!selected}
        onClick={() => selected && onChoose(selected)}
      >
        {selected ? `Start with ${PIXEL_COMPANIONS[selected].label}` : "Pick a companion"}
      </button>
    </div>
  );
}
