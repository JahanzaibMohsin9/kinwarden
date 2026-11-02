import { ImageResponse } from "next/og";
import { AppIconArt } from "@/components/AppIconArt";

// The browser-tab icon: the same mark as the installed app (replaces Next's default favicon.ico).
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<AppIconArt size={64} padding={0.06} />, size);
}
