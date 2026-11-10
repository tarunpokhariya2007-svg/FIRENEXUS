import React from 'react';
import { cn } from '../../utils/cn';

/** Placeholder block for content that is loading. Size it with className (h-4 w-32 ...). */
export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div aria-hidden="true" className={cn('rounded-md bg-surface-container-high animate-pulse motion-reduce:animate-none', className)} {...rest} />
);
