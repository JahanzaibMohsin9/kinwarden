import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/app/AppShell";
import { AppAside } from "@/components/app/AppAside";

export const metadata: Metadata = { title: "Kinwarden · Family app" };

export default function FamilyAppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Providers>
      <div className="min-h-dvh bg-bg-deep">
        <AppAside />
        <AppShell>{children}</AppShell>
      </div>
    </Providers>
  );
}
