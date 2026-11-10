import React from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header content, e.g. a button. */
  actions?: React.ReactNode;
  /** 'none' lets children (tables, maps) run edge to edge. */
  padding?: 'none' | 'md' | 'lg';
  as?: 'section' | 'div' | 'article';
}

const paddings = { none: '', md: 'p-5', lg: 'p-6' } as const;

/** A single analytical surface. Avoid nesting Cards; separate groups inside one with a divider instead. */
export const Card: React.FC<CardProps> = ({
  title, description, actions, padding = 'lg', as: Tag = 'section', className, children, ...rest
}) => {
  const hasHeader = title || description || actions;
  return (
    <Tag className={cn('rounded-xl border border-border-grid bg-surface-container-lowest shadow-card', className)} {...rest}>
      {hasHeader && (
        <header className={cn('flex flex-wrap items-start justify-between gap-3', padding === 'none' ? 'p-5 pb-4' : cn(paddings[padding], 'pb-0'))}>
          <div className="min-w-0">
            {title && <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>}
            {description && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(paddings[padding], hasHeader && padding !== 'none' && 'pt-4')}>{children}</div>
    </Tag>
  );
};
