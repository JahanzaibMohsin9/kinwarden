import { geoContains, geoEquirectangular } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land from "world-atlas/land-110m.json";

// The landing page's map: the world's land as dots (Natural Earth 1:110m, drawn once on the server),
// and the corridors Kinwarden works on as glowing routes with payments moving along them.

const W = 1000;
const H = 470;
const STEP = 1.6; // degrees between dots

type City = { name: string; lon: number; lat: number; dx?: number; dy?: number; anchor?: "start" | "end" | "middle" };
const CITY: Record<string, City> = {
  lahore: { name: "Lahore", lon: 74.35, lat: 31.55, dx: 8, dy: -6 },
  karachi: { name: "Karachi", lon: 67.0, lat: 24.86, dx: -8, dy: 14, anchor: "end" },
  bangkok: { name: "Bangkok", lon: 100.5, lat: 13.75, dx: -8, dy: 16, anchor: "end" },
  shenzhen: { name: "Shenzhen", lon: 114.06, lat: 22.54, dx: 8, dy: 4 },
  london: { name: "London", lon: -0.13, lat: 51.5, dx: -8, dy: -8, anchor: "end" },
  singapore: { name: "Singapore", lon: 103.82, lat: 1.35, dx: 8, dy: 12 },
  dubai: { name: "Dubai", lon: 55.27, lat: 25.2, dx: -6, dy: 14, anchor: "end" },
  kl: { name: "Kuala Lumpur", lon: 101.69, lat: 3.14 },
  istanbul: { name: "Istanbul", lon: 28.98, lat: 41.01, dx: 0, dy: -10, anchor: "middle" },
};

const ROUTES: { from: string; to: string; label: string; main: boolean; dur: number }[] = [
  { from: "lahore", to: "bangkok", label: "PKR → THB · hospital", main: true, dur: 3.4 },
  { from: "shenzhen", to: "london", label: "CNY → GBP · tuition", main: true, dur: 5.2 },
  { from: "karachi", to: "london", label: "PKR → GBP · tuition", main: true, dur: 4.4 },
  { from: "lahore", to: "singapore", label: "", main: false, dur: 4.2 },
  { from: "karachi", to: "dubai", label: "", main: false, dur: 2.6 },
  { from: "shenzhen", to: "kl", label: "", main: false, dur: 3.6 },
  { from: "lahore", to: "istanbul", label: "", main: false, dur: 4.8 },
];

function build() {
  const topo = land as unknown as Topology<{ land: GeometryCollection }>;
  const shape = feature(topo, topo.objects.land);
  const projection = geoEquirectangular()
    .center([62, 28])
    .scale(W / ((175 / 180) * Math.PI))
    .translate([W / 2, H / 2]);
  let dots = "";
  for (let lat = 72; lat >= -38; lat -= STEP) {
    for (let lon = -30; lon <= 160; lon += STEP) {
      if (!geoContains(shape, [lon, lat])) continue;
      const [x, y] = projection([lon, lat])!;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      dots += `M${x.toFixed(1)} ${y.toFixed(1)}h2.8v2.8h-2.8z`;
    }
  }
  const pt = (c: City) => projection([c.lon, c.lat])!;
  const routes = ROUTES.map((r) => {
    const [x1, y1] = pt(CITY[r.from]);
    const [x2, y2] = pt(CITY[r.to]);
    const len = Math.hypot(x2 - x1, y2 - y1);
    // bow each route upwards, like a flight path
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 - len * 0.28;
    return { ...r, d: `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, mid: [cx, (y1 + y2) / 2 - len * 0.15] as const };
  });
  const cities = Object.entries(CITY).map(([id, c]) => ({ id, ...c, xy: pt(c), main: ROUTES.some((r) => r.main && (r.from === id || r.to === id)) }));
  return { dots, routes, cities };
}

const MAP = build();

export function MoneyMap({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="Map of Kinwarden's corridors: Pakistan to Thailand for hospital bills, China and Pakistan to the United Kingdom for tuition, and more destinations for uploaded bills">
      <defs>
        <radialGradient id="mm-glow">
          <stop offset="0%" stopColor="#5ccdb4" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#5ccdb4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mm-route" x1="0" x2="1">
          <stop offset="0%" stopColor="#5ccdb4" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#5ccdb4" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <path d={MAP.dots} fill="#9fd9cb" fillOpacity="0.2" />
      {MAP.routes.map((r) => (
        <g key={r.from + r.to}>
          <path d={r.d} fill="none" stroke={r.main ? "url(#mm-route)" : "#5ccdb4"} strokeOpacity={r.main ? 1 : 0.28} strokeWidth={r.main ? 1.8 : 1} strokeDasharray={r.main ? "5 6" : "2 5"} className="route-dash" />
          <g className="route-dot">
            <circle r={r.main ? 9 : 5} fill="url(#mm-glow)">
              <animateMotion dur={`${r.dur}s`} repeatCount="indefinite" path={r.d} />
            </circle>
            <circle r={r.main ? 2.6 : 1.6} fill="#e9fff9">
              <animateMotion dur={`${r.dur}s`} repeatCount="indefinite" path={r.d} />
            </circle>
          </g>
          {r.label && (
            <text x={r.mid[0]} y={r.mid[1]} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#9fd9cb" letterSpacing="0.3">
              {r.label}
            </text>
          )}
        </g>
      ))}
      {MAP.cities.map((c) => (
        <g key={c.id}>
          <circle cx={c.xy[0]} cy={c.xy[1]} r={c.main ? 3.6 : 2.4} fill={c.main ? "#5ccdb4" : "#5ccdb4"} fillOpacity={c.main ? 1 : 0.6} />
          {c.main && <circle cx={c.xy[0]} cy={c.xy[1]} r="8" fill="none" stroke="#5ccdb4" strokeOpacity="0.35" />}
          {c.dx !== undefined && (
            <text x={c.xy[0] + c.dx} y={c.xy[1] + (c.dy ?? 0)} textAnchor={c.anchor ?? "start"} fontSize={c.main ? 12.5 : 11} fontWeight={c.main ? 600 : 500} fill={c.main ? "#e9f1ee" : "#7d918c"}>
              {c.name}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
