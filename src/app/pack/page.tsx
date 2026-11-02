import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { CasePack } from "@/components/CasePack";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = { title: "Case pack" };

export default function Page() {
  return (
    <Providers>
      <div className="min-h-dvh bg-white">
        <div className="print:hidden">
          <SiteNav />
        </div>
        <CasePack />
      </div>
    </Providers>
  );
}
