"use client";

import { CarryProvider } from "@/lib/client";
import { LangProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CarryProvider>
      <LangProvider>{children}</LangProvider>
    </CarryProvider>
  );
}
