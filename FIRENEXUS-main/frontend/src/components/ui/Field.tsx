import React from 'react';
import { cn } from '../../utils/cn';

/** Shared style for text, number, date and select controls. Add w-* / font-mono as needed. */
export const inputClass =
  'h-10 rounded-lg border border-border-grid bg-surface-container-lowest px-3 font-body text-body-md text-on-surface ' +
  'hover:border-outline-variant focus-visible:border-primary disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant';

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  /** Right-aligned content on the label row, e.g. a live value. */
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + optional hint. Pass htmlFor when the control has an id. */
export const Field: React.FC<FieldProps> = ({ label, htmlFor, hint, right, className, children }) => (
  <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="font-body text-body-sm font-medium text-on-surface">{label}</label>
      {right}
    </div>
    {children}
    {hint && <p className="font-body text-body-sm text-on-surface-variant">{hint}</p>}
  </div>
);
