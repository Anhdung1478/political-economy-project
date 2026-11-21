import { cx } from './cx';

interface Props {
  /** The mode of the page showing it. */
  mode: 'solo' | 'multi';
}

const HINT = {
  solo: 'Chơi một mình, điểm cao nhất của mỗi tên lên bảng xếp hạng chung.',
  multi: 'Giảng viên mở buổi chơi, cả lớp cạnh tranh trên bảng xếp hạng lớp.',
} as const;

/** "Một mình | Nhiều người": two links (the current one is `aria-current`), so each is a page of its own. */
export function ModeSwitch({ mode }: Props) {
  const item = (m: Props['mode'], href: string, label: string) => (
    <a href={href} className={cx('mswitch__opt', mode === m && 'is-on')} aria-current={mode === m ? 'page' : undefined}
      aria-describedby={mode === m ? 'mswitch-hint' : undefined}>
      {label}
    </a>
  );
  return (
    <div className="mswitch">
      <nav className="mswitch__bar" aria-label="Chế độ chơi">
        {item('solo', '/', 'Một mình')}
        {item('multi', '/play', 'Nhiều người')}
      </nav>
      <p className="mswitch__hint" id="mswitch-hint">{HINT[mode]}</p>
    </div>
  );
}
