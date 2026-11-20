// ============================================================================================================
// AMBIENT STREET SLOT (projector background while the market is open).
//
// This is a calm, static stand-in. Once the scene has an ambient mode (Task 17), replace the body of
// `StreetBackdrop` with `<StreetCanvas mode="ambient" ... />` (lazy-loaded, so the host bundle stays small) and keep
// the wrapper `div.street-slot` and its `data-street-slot` attribute: ProjectorView sizes and layers it through them.
// The overlay cards in ProjectorView sit on top and do not depend on what is drawn here.
// ============================================================================================================

const SHOPS = [
  { x: 40, w: 230, h: 300, wall: 'var(--milk)', awning: 'var(--matcha)' },
  { x: 290, w: 200, h: 360, wall: 'var(--caramel-soft)', awning: 'var(--strawberry)' },
  { x: 510, w: 250, h: 280, wall: 'var(--paper)', awning: 'var(--caramel)' },
  { x: 780, w: 220, h: 340, wall: 'var(--matcha-soft)', awning: 'var(--boba)' },
  { x: 1020, w: 240, h: 300, wall: 'var(--strawberry-soft)', awning: 'var(--matcha)' },
  { x: 1280, w: 280, h: 350, wall: 'var(--milk)', awning: 'var(--caramel)' },
];
const GROUND = 720;

export function StreetBackdrop() {
  return (
    <div className="street-slot" data-street-slot="static" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fbe3c4" />
            <stop offset="1" stopColor="#fff6ea" />
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#hs-sky)" />
        <circle cx="1320" cy="150" r="70" fill="#f6c88a" opacity="0.6" />
        {/* far rooftops */}
        <path d="M0 420 L120 380 L240 410 L380 360 L520 400 L680 350 L820 395 L980 355 L1120 400 L1280 360 L1440 395 L1600 370 L1600 720 L0 720 Z"
          fill="var(--milk-deep)" opacity="0.45" />
        {SHOPS.map((s, i) => {
          const top = GROUND - s.h;
          return (
            <g key={i}>
              <rect x={s.x} y={top} width={s.w} height={s.h} rx="14" fill={s.wall} stroke="var(--line-strong)" strokeWidth="2" />
              {/* upstairs windows */}
              <rect x={s.x + 30} y={top + 30} width={s.w / 2 - 45} height="60" rx="10" fill="#fff" opacity="0.7" />
              <rect x={s.x + s.w / 2 + 15} y={top + 30} width={s.w / 2 - 45} height="60" rx="10" fill="#fff" opacity="0.7" />
              {/* awning: scalloped strip */}
              <rect x={s.x - 8} y={GROUND - 190} width={s.w + 16} height="34" rx="8" fill={s.awning} />
              {Array.from({ length: Math.floor((s.w + 16) / 32) }, (_, k) => (
                <circle key={k} cx={s.x - 8 + 16 + k * 32} cy={GROUND - 156} r="16" fill={s.awning} />
              ))}
              {/* counter + door */}
              <rect x={s.x + 20} y={GROUND - 110} width={s.w - 40} height="110" rx="10" fill="var(--paper)" opacity="0.85" />
              <rect x={s.x + 20} y={GROUND - 70} width={s.w - 40} height="12" rx="6" fill="var(--tea)" />
            </g>
          );
        })}
        {/* string lights */}
        <path d="M0 250 Q400 320 800 250 T1600 250" fill="none" stroke="var(--boba)" strokeWidth="2" opacity="0.4" />
        {Array.from({ length: 21 }, (_, i) => {
          const x = i * 80;
          // On the curve above: each half is a quadratic with its control point 70 below (then above) the line.
          const t = (x % 800) / 800;
          const y = 250 + (x < 800 ? 1 : -1) * 2 * t * (1 - t) * 70;
          return <circle key={i} cx={x} cy={y} r="7" fill={['var(--tea)', 'var(--strawberry)', 'var(--matcha)'][i % 3]} opacity="0.75" />;
        })}
        {/* pavement and road */}
        <rect y={GROUND} width="1600" height="50" fill="var(--milk-deep)" />
        <rect y={GROUND + 50} width="1600" height="130" fill="#d9c3a5" />
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x={i * 170 + 30} y={GROUND + 110} width="90" height="10" rx="5" fill="var(--paper)" opacity="0.7" />
        ))}
      </svg>
    </div>
  );
}
