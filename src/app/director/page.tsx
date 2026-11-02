import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { DirectorPanel } from "@/components/world/DirectorPanel";
import { AgentConsole } from "@/components/world/AgentConsole";
import { PageIntro, SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = { title: "Kinwarden · Director" };

export default function Page() {
  return (
    <Providers>
      <div className="flex h-dvh flex-col bg-bg">
        <SiteNav />
        <PageIntro title="Director: the sandbox's control room">
          Move the simulated world forward (the next email, bill or bank event), switch the agent between Live AI, Replay and Scripted, break things with chaos mode, or edit the log to see the tamper check fail. On the right: everything the agent did.
        </PageIntro>
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-5 py-3">
          <DirectorPanel />
          <div className="min-h-0 flex-1">
            <AgentConsole />
          </div>
        </div>
      </div>
    </Providers>
  );
}
