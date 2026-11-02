import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Noto_Nastaliq_Urdu, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin", "latin-ext"] });
const jbmono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"] });
const nastaliq = Noto_Nastaliq_Urdu({ variable: "--font-nastaliq", subsets: ["arabic"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "Kinwarden",
  description: "The AI agent that pays your family's hospital and university bills abroad: legally, safely and for less.",
  appleWebApp: { capable: true, title: "Kinwarden", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1312" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jbmono.variable} ${nastaliq.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
