import React from 'react';
import { cn } from '../../utils/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Single-choice toggle group. Each option is a button with aria-pressed. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = 'md', className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-surface-container-high p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-body font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-label-xs' : 'h-8 px-3 text-body-sm',
              active ? 'bg-surface-container-lowest text-on-surface shadow-card' : 'text-on-surface-variant hover:text-on-surface',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-on-surface-variant',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
