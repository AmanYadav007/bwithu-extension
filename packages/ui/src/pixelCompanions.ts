import type { CompanionAvatar } from "@bwithu/shared";

export interface PixelCompanionSpec {
  label: string;
  /** Backdrop colour behind the portrait on the picker card. */
  cardColor: string;
  /** xAI voice that matches the character. */
  voiceId: string;
}

export const PIXEL_COMPANIONS: Record<CompanionAvatar, PixelCompanionSpec> = {
  male: { label: "Male", cardColor: "#725977", voiceId: "rex" },
  female: { label: "Female", cardColor: "#efcba5", voiceId: "ara" },
};
