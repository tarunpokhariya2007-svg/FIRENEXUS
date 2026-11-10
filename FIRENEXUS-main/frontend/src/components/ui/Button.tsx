import React from 'react';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Material Symbols icon name shown before the label. */
  icon?: string;
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  // #9e3d19 on white is the preferred action colour; hover darkens for contrast instead of lightening.
  primary: 'bg-primary text-on-primary shadow-card hover:bg-on-primary-fixed-variant active:bg-on-primary-fixed',
  secondary: 'bg-surface-container-lowest text-on-surface border border-border-grid hover:bg-surface-container-low hover:border-outline-variant',
  ghost: 'bg-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
  danger: 'bg-error text-on-error shadow-card hover:bg-on-error-container',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-body-sm gap-1.5',
  md: 'h-10 px-4 text-body-md gap-2',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-body font-medium whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none" />
      ) : (
        icon && <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{icon}</span>
      )}
      {children}
    </button>
  );
});
