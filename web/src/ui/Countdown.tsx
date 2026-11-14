import { useNow } from '../net/socket';
import { cx } from './cx';

interface Props { deadline: number | null; serverOffset: number; total: number; size?: number }

/** SVG ring counting down to a server-clock deadline. */
export function Countdown({ deadline, serverOffset, total, size = 120 }: Props) {
  const now = useNow(200) + serverOffset;
  const left = deadline === null ? 0 : Math.max(0, (deadline - now) / 1000);
  const secs = Math.ceil(left);
  const stroke = Math.max(6, size * 0.09);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cx('countdown', secs <= 5 && 'countdown--hurry')} role="timer" aria-label={`Còn ${secs} giây`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="countdown__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="countdown__bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, left / total))}
        />
      </svg>
      <span className="countdown__num" style={{ fontSize: size * 0.36 }}>{secs}</span>
    </div>
  );
}
