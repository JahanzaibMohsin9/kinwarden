import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { OfficerDesk } from "@/components/world/OfficerDesk";
import { PageIntro, SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = { title: "Remittance desk (sandbox bank)" };

export default function Page() {
  return (
    <Providers>
      <div className="flex h-dvh flex-col bg-[#0b1016] p-2 sm:">
        <SiteNav tone="dark" />
        <PageIntro title="Bank officer (sandbox)">
          What a bank such as WeBank would see: a remittance package Kinwarden prepared, with the documents checked, the rules cited and a draft SWIFT message, ready to approve.
        </PageIntro>
        <div className="mx-auto min-h-0 w-full max-w-6xl flex-1 px-5 py-3">
          <OfficerDesk />
        </div>
      </div>
    </Providers>
  );
}
