import React from 'react';
import { ApiError } from '../../services/api';

interface BaseProps {
  className?: string;
}

/** Visual language matches the existing Stitch cards: mono caps, surface-container tones, 1px structural border. */
export const LoadingState: React.FC<BaseProps & { label?: string }> = ({ label = 'LOADING...', className = '' }) => (
  <div className={`flex items-center justify-center gap-2 font-mono text-label-sm text-on-surface-variant ${className}`}>
    <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
    <span>{label}</span>
  </div>
);

export const ErrorState: React.FC<BaseProps & { error: ApiError | Error; onRetry?: () => void }> = ({
  error,
  onRetry,
  className = '',
}) => (
  <div
    role="alert"
    className={`flex flex-col items-center justify-center gap-2 text-center font-mono p-space-md bg-error-container/40 border border-error/30 rounded ${className}`}
  >
    <span className="material-symbols-outlined text-[22px] text-error">error</span>
    <span className="font-label-sm text-label-sm font-semibold text-on-error-container uppercase">Request failed</span>
    <span className="font-label-xs text-label-xs text-on-surface-variant max-w-md">{error.message}</span>
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-1 px-space-sm py-1 rounded bg-surface-container-lowest border border-structural text-on-surface font-label-xs text-label-xs hover:bg-surface-container"
      >
        Retry
      </button>
    )}
  </div>
);

export const EmptyState: React.FC<
  BaseProps & { title?: string; detail?: string; icon?: string; compact?: boolean }
> = ({ title = 'No dataset loaded', detail = 'Awaiting NASA dataset', icon = 'database_off', compact = false, className = '' }) => (
  <div
    className={`flex flex-col items-center justify-center text-center font-mono text-on-surface-variant ${
      compact ? 'gap-0.5 py-space-sm' : 'gap-1 py-space-lg'
    } ${className}`}
  >
    <span className={`material-symbols-outlined ${compact ? 'text-[18px]' : 'text-[26px]'} text-outline`}>{icon}</span>
    <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface">{title}</span>
    <span className="font-label-xs text-label-xs">{detail}</span>
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
  <span
    className={`inline-flex items-center gap-1 px-space-xs py-0.5 rounded font-label-xs text-label-xs font-mono ${
      loaded ? 'bg-surface-container-high text-[#527A63]' : 'bg-surface-container-high text-on-surface-variant'
    }`}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${loaded ? 'bg-[#527A63]' : 'bg-outline'}`}></span>
    {loaded ? `${count} DATASET${count === 1 ? '' : 'S'} LOADED` : 'NO DATASET LOADED'}
  </span>
);
