import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { HospitalDesk } from "@/components/world/HospitalDesk";
import { PageIntro, SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = { title: "Institution desk (sandbox)" };

export default function Page() {
  return (
    <Providers>
      <div className="flex h-dvh flex-col bg-[#e9edf3]">
        <SiteNav tone="light" />
        <PageIntro title="Hospital & university desk (sandbox)">
          The institution&apos;s side: every email the agent sends arrives here, and the simulated hospital or university answers it, sends bills, receipts and refunds. In real life these are people; here they are an auto-responder.
        </PageIntro>
        <div className="mx-auto min-h-0 w-full max-w-6xl flex-1 px-5 py-3">
          <HospitalDesk />
        </div>
      </div>
    </Providers>
  );
}
