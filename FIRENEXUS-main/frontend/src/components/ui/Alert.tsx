import React from 'react';
import { cn } from '../../utils/cn';
import { Button } from './Button';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone;
  title?: React.ReactNode;
  /** Renders a Retry button. */
  onRetry?: () => void;
  retryLabel?: string;
}

const tones: Record<AlertTone, { box: string; icon: string; name: string }> = {
  info: { box: 'bg-secondary-fixed/40 border-secondary/25 text-on-secondary-fixed', icon: 'info', name: 'text-secondary' },
  success: { box: 'bg-validated/10 border-validated/30 text-on-surface', icon: 'check_circle', name: 'text-validated' },
  warning: { box: 'bg-tertiary-fixed/60 border-tertiary-container/40 text-on-tertiary-fixed', icon: 'warning', name: 'text-tertiary' },
  error: { box: 'bg-error-container/50 border-error/30 text-on-error-container', icon: 'error', name: 'text-error' },
};

/** Inline message. Errors and warnings are announced immediately; info and success politely. */
export const Alert: React.FC<AlertProps> = ({ tone = 'info', title, onRetry, retryLabel = 'Retry', className, children, ...rest }) => {
  const t = tones[tone];
  const urgent = tone === 'error' || tone === 'warning';
  return (
    <div role={urgent ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-lg border p-4', t.box, className)} {...rest}>
      <span aria-hidden="true" className={cn('material-symbols-outlined mt-0.5 text-[20px] leading-none', t.name)}>{t.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-body text-body-md font-semibold">{title}</p>}
        {children && <div className={cn('font-body text-body-sm', title && 'mt-0.5')}>{children}</div>}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry} className="shrink-0">{retryLabel}</Button>
      )}
    </div>
  );
};
