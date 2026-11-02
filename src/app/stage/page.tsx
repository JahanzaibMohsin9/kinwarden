import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { Stage } from "@/components/world/Stage";

export const metadata: Metadata = { title: "Kinwarden · Live demo stage" };

export default function Page() {
  return (
    <Providers>
      <Stage />
    </Providers>
  );
}
