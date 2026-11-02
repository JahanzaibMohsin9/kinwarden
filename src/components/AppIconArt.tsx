// The Kinwarden mark for app icons (rendered by next/og, so plain inline styles and fixed colours).
// Same drawing as <Logo />: an arc carrying a coin from home to the institution.
export function AppIconArt({ size, padding = 0 }: { size: number; padding?: number }) {
  const inner = size * (1 - 2 * padding);
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0e6b5c" }}>
      <svg width={inner} height={inner} viewBox="4 6 24 24">
        <path d="M8.5 21.5c2.2-7.6 12.8-7.6 15 0" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="8.5" cy="21.5" r="2.6" fill="#ffffff" />
        <circle cx="23.5" cy="21.5" r="2.6" fill="#fbefd9" stroke="#ffffff" strokeWidth="1.6" />
        <circle cx="16" cy="13.3" r="1.7" fill="#ffffff" />
      </svg>
    </div>
  );
}
