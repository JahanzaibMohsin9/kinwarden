import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { StoryPlayer } from "@/components/story/StoryPlayer";

export const metadata: Metadata = { title: "Kinwarden · Watch a real case", description: "A father's heart treatment in Bangkok, paid by Kinwarden's AI agent under Pakistan's rules." };

export default function Page() {
  return (
    <Providers>
      <StoryPlayer />
    </Providers>
  );
}
