import type { MetadataRoute } from "next";

// Installable web app: judges and families open a link and add it to the home screen, no APK needed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kinwarden",
    short_name: "Kinwarden",
    description: "The AI agent that pays your family's hospital and university bills abroad: legally, safely and for less.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f1ea",
    theme_color: "#0e6b5c",
    categories: ["finance"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
