import type { SVGProps } from 'react';
import { cx } from './cx';

/** One open palm built from capsules; drawn twice (outline under, fill over) so the outline traces the silhouette. */
function Silhouette(props: SVGProps<SVGGElement>) {
  return (
    <g {...props}>
      <rect x="32" y="24" width="15" height="58" rx="7.5" />
      <rect x="49" y="12" width="15" height="68" rx="7.5" />
      <rect x="66" y="16" width="15" height="64" rx="7.5" />
      <rect x="83" y="30" width="14" height="50" rx="7" />
      <rect x="14" y="60" width="16" height="48" rx="8" transform="rotate(-36 22 108)" />
      <rect x="28" y="58" width="70" height="60" rx="24" />
    </g>
  );
}

const Spark = ({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) => (
  <path
    className="hand__spark"
    d={`M${x} ${y - s}Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y}Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s}Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y}Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}Z`}
    fill={fill}
  />
);

interface HandProps { size?: number; float?: boolean; className?: string; title?: string }

/** The invisible hand: a ghost palm with a dashed outline and sparkles. */
export function InvisibleHand({ size = 160, float, className, title = 'Bàn tay vô hình' }: HandProps) {
  return (
    <svg className={cx('hand', float && 'hand--float', className)} width={size} height={size * 1.25} viewBox="0 0 120 150" role="img" aria-label={title}>
      <Silhouette fill="none" stroke="var(--matcha-deep)" strokeWidth="4.5" strokeDasharray="6 6" strokeLinecap="round" />
      <Silhouette fill="var(--matcha-soft)" />
      <rect x="36" y="112" width="54" height="26" rx="7" fill="none" stroke="var(--matcha-deep)" strokeWidth="4" strokeDasharray="6 6" />
      <Spark x={8} y={22} s={9} fill="var(--matcha)" />
      <Spark x={110} y={14} s={7} fill="var(--tea)" />
      <Spark x={112} y={98} s={8} fill="var(--matcha)" />
    </svg>
  );
}

/** The visible hand: a solid caramel glove with an official star on the cuff. */
export function VisibleHand({ size = 160, float, className, title = 'Bàn tay hữu hình' }: HandProps) {
  return (
    <svg className={cx('hand', float && 'hand--float', className)} width={size} height={size * 1.25} viewBox="0 0 120 150" role="img" aria-label={title}>
      <Silhouette fill="var(--ink)" stroke="var(--ink)" strokeWidth="8" strokeLinejoin="round" />
      <Silhouette fill="var(--caramel)" />
      <g stroke="var(--caramel-deep)" strokeWidth="3" strokeLinecap="round" opacity="0.7">
        <path d="M44 74v-8M58 72v-10M74 72v-9M90 74v-6" />
      </g>
      <rect x="34" y="110" width="58" height="30" rx="7" fill="var(--paper)" stroke="var(--ink)" strokeWidth="4.5" />
      <path d="M63 116l3.2 6.6 7.2 1-5.2 5 1.3 7.2-6.5-3.4-6.5 3.4 1.3-7.2-5.2-5 7.2-1z" fill="var(--strawberry)" />
    </svg>
  );
}
