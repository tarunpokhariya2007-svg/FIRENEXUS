import React from 'react';
import { cn } from '../../utils/cn';

export type BadgeTone = 'neutral' | 'primary' | 'modis' | 'viirs' | 'success' | 'warning' | 'error';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Small coloured dot before the label. Sensor tones always show it. */
  dot?: boolean;
}

// Text colours are chosen for contrast on a light tint. Sensor identity is carried by the dot
// (#487D9A / #D18445), because those hues are too light for small text.
const tones: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: 'bg-surface-container text-on-surface-variant', dot: 'bg-outline' },
  primary: { box: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  modis: { box: 'bg-modis/10 text-secondary', dot: 'bg-modis' },
  viirs: { box: 'bg-viirs/15 text-tertiary', dot: 'bg-viirs' },
  success: { box: 'bg-validated/10 text-validated', dot: 'bg-validated' },
  warning: { box: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', dot: 'bg-tertiary-container' },
  error: { box: 'bg-error-container text-on-error-container', dot: 'bg-error' },
};

/** Use sparingly: for a status or a sensor identity, not as decoration. */
export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', dot, className, children, ...rest }) => {
  const t = tones[tone];
  const showDot = dot ?? (tone === 'modis' || tone === 'viirs');
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-label-xs text-label-xs', t.box, className)} {...rest}>
      {showDot && <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {children}
    </span>
  );
};
