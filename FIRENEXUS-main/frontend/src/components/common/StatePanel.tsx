import React from 'react';
import { ApiError } from '../../services/api';
import { cn } from '../../utils/cn';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';

interface BaseProps {
  className?: string;
}

/**
 * Several pages still pass SHOUTING labels ("LOADING DATA LABORATORY CATALOG...").
 * Render those in sentence case so shared states read consistently until each page is revised.
 * Mixed-case text is left untouched.
 */
function readable(text: string): string {
  const t = text.trim().replace(/\.{3}$/, '…');
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    const lower = t.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return t;
}

export const LoadingState: React.FC<BaseProps & { label?: string }> = ({ label = 'Loading…', className = '' }) => (
  <div role="status" aria-live="polite" className={cn('flex items-center justify-center gap-3 text-on-surface-variant', className)}>
    <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin motion-reduce:animate-none" />
    <span className="font-body text-body-md">{readable(label)}</span>
  </div>
);

export const ErrorState: React.FC<BaseProps & { error: ApiError | Error; onRetry?: () => void }> = ({
  error,
  onRetry,
  className = '',
}) => {
  const unreachable = error instanceof ApiError && error.code === 'NETWORK_ERROR';
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <Alert
        tone="error"
        title={unreachable ? 'Can’t reach the FIRENEXUS API' : 'This request failed'}
        onRetry={onRetry}
        className="w-full max-w-xl"
      >
        {/* The server’s own message is shown unchanged so nothing is hidden from the researcher. */}
        {/^request failed$/i.test(error.message.trim()) ? null : error.message}
      </Alert>
    </div>
  );
};

export const EmptyState: React.FC<
  BaseProps & { title?: string; detail?: string; icon?: string; compact?: boolean }
> = ({ title = 'No dataset loaded', detail = 'Awaiting NASA dataset', icon = 'database_off', compact = false, className = '' }) => (
  <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-1 py-3' : 'gap-2 py-8', className)}>
    <span
      aria-hidden="true"
      className={cn(
        'material-symbols-outlined flex items-center justify-center rounded-full bg-surface-container text-outline',
        compact ? 'h-8 w-8 text-[18px]' : 'h-12 w-12 text-[24px]',
      )}
    >
      {icon}
    </span>
    <span className="font-body text-body-md font-semibold text-on-surface">{readable(title)}</span>
    {detail && <span className="max-w-sm font-body text-body-sm text-on-surface-variant">{readable(detail)}</span>}
  </div>
);

/** Shared page-level guard: loading -> error -> children. */
export const ResourceBoundary: React.FC<{
  loading: boolean;
  error: ApiError | null;
  onRetry?: () => void;
  loadingLabel?: string;
  minHeightClass?: string;
  children: React.ReactNode;
}> = ({ loading, error, onRetry, loadingLabel, minHeightClass = 'min-h-[500px]', children }) => {
  if (loading) return <LoadingState label={loadingLabel} className={`p-space-lg ${minHeightClass}`} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} className={`m-space-lg ${minHeightClass}`} />;
  return <>{children}</>;
};

export const DatasetBadge: React.FC<{ loaded: boolean; count?: number }> = ({ loaded, count = 0 }) => (
  <Badge tone={loaded ? 'success' : 'neutral'} dot>
    {loaded ? `${count} dataset${count === 1 ? '' : 's'} loaded` : 'No dataset loaded'}
  </Badge>
);
