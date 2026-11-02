import { ImageResponse } from "next/og";
import { AppIconArt } from "@/components/AppIconArt";

// /pwa-icon/192, /pwa-icon/512 and /pwa-icon/maskable for the web app manifest.
export async function GET(_request: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size: param } = await ctx.params;
  const maskable = param === "maskable";
  const size = maskable ? 512 : Math.min(1024, Math.max(48, Number(param) || 192));
  // maskable icons get cropped to a circle or squircle: keep the mark inside the safe zone
  return new ImageResponse(<AppIconArt size={size} padding={maskable ? 0.2 : 0.08} />, { width: size, height: size });
}
