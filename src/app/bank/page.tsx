import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { BankConsole } from "@/components/world/BankConsole";
import { PageIntro, SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = { title: "Payment rails (sandbox)" };

export default function Page() {
  return (
    <Providers>
      <div className="flex h-dvh flex-col bg-[#0b1016]">
        <SiteNav tone="dark" />
        <PageIntro title="Payment rails (sandbox)">
          The money moving: SWIFT transfers in flight, card payments, returns and refunds, with the cost of each route in the family&apos;s currency. No real money moves.
        </PageIntro>
        <div className="mx-auto min-h-0 w-full max-w-6xl flex-1 px-5 py-3">
          <BankConsole />
        </div>
      </div>
    </Providers>
  );
}
