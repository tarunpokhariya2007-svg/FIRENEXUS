import React from 'react';
import { cn } from '../../utils/cn';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned primary and secondary actions. */
  actions?: React.ReactNode;
  className?: string;
}

/** Standard page heading. The only place Manrope (font-headline-lg) is used besides the brand mark. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, className }) => (
  <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
    <div className="min-w-0 max-w-3xl">
      <h1 className="font-headline-lg text-headline-lg text-on-surface">{title}</h1>
      {description && <p className="mt-1.5 font-body text-body-lg text-on-surface-variant">{description}</p>}
    </div>
    {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
  </div>
);
