"use client";

import { useEffect, useState } from "react";

/** The anchor count read from the public chain, refreshed every minute. */
export function LiveAnchorCount() {
  const [s, setS] = useState<{ count: number | null; contractUrl?: string } | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/anchors/stats")
        .then((r) => r.json())
        .then((j: { enabled: boolean; count?: number | null; contractUrl?: string }) => setS(j.enabled ? { count: j.count ?? null, contractUrl: j.contractUrl } : null))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!s || s.count === null) return <span>On-chain</span>;
  return (
    <a href={s.contractUrl} target="_blank" rel="noreferrer" className="hover:underline">
      {s.count.toLocaleString("en-US")}
    </a>
  );
}
