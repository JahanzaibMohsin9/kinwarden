// Small SVG flags: emoji flags don't render on Windows, so draw them.
const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
};

export function Flag({ code, className = "" }: { code: "PK" | "TH" | "CN" | "GB" | string; className?: string }) {
  const common = { viewBox: "0 0 30 20", className: `inline-block h-[0.8em] w-auto shrink-0 rounded-[2px] align-[-0.06em] shadow-[0_0_0_0.5px_rgba(0,0,0,0.2)] ${className}`, role: "img", "aria-label": code };
  switch (code) {
    case "PK":
      return (
        <svg {...common}>
          <rect width="30" height="20" fill="#01411C" />
          <rect width="7.5" height="20" fill="#fff" />
          <circle cx="19" cy="10" r="5.6" fill="#fff" />
          <circle cx="20.6" cy="8.6" r="4.8" fill="#01411C" />
          <polygon points={star(22.2, 7.2, 1.9)} fill="#fff" />
        </svg>
      );
    case "TH":
      return (
        <svg {...common}>
          <rect width="30" height="20" fill="#A51931" />
          <rect y="3.33" width="30" height="13.33" fill="#F4F5F8" />
          <rect y="6.67" width="30" height="6.67" fill="#2D2A4A" />
        </svg>
      );
    case "CN":
      return (
        <svg {...common}>
          <rect width="30" height="20" fill="#DE2910" />
          <polygon points={star(5, 5, 3)} fill="#FFDE00" />
          <polygon points={star(10, 2, 1)} fill="#FFDE00" />
          <polygon points={star(12, 4, 1)} fill="#FFDE00" />
          <polygon points={star(12, 7, 1)} fill="#FFDE00" />
          <polygon points={star(10, 9, 1)} fill="#FFDE00" />
        </svg>
      );
    case "GB":
      return (
        <svg {...common}>
          <clipPath id="gb-clip">
            <rect width="30" height="20" />
          </clipPath>
          <g clipPath="url(#gb-clip)">
            <rect width="30" height="20" fill="#012169" />
            <path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" strokeWidth="4" />
            <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" strokeWidth="1.6" />
            <path d="M15,0 V20 M0,10 H30" stroke="#fff" strokeWidth="6" />
            <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" strokeWidth="3.4" />
          </g>
        </svg>
      );
    default:
      // countries an uploaded bill can come from: a neutral tag with the country code
      return (
        <svg {...common}>
          <rect width="30" height="20" fill="var(--surface-3)" />
          <text x="15" y="14.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink-2)">
            {code}
          </text>
        </svg>
      );
  }
}
