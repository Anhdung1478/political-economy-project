import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'caramel' | 'danger' | 'dark' | 'secondary' | 'ghost';
  size?: 'md' | 'lg' | 'xl' | 'icon';
  icon?: ReactNode;
  block?: boolean;
};

export function Button({ variant = 'primary', size = 'md', icon, block, className, children, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className)} {...rest}>
      {icon && <span className="btn__icon" aria-hidden="true">{icon}</span>}
      {children !== undefined && <span>{children}</span>}
    </button>
  );
}
