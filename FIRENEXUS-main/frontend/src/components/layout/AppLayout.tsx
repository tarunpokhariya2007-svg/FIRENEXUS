import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useDatasetStatus } from '../../hooks/DatasetStatusContext';
import { cn } from '../../utils/cn';
import { Badge } from '../ui/Badge';

interface NavItem {
  name: string;
  path: string;
  icon: string;
}

const navItems: NavItem[] = [
  { name: 'Overview', path: '/app', icon: 'dashboard' },
  { name: 'Fire Explorer', path: '/app/fire-explorer', icon: 'explore' },
  { name: 'Harmonization Studio', path: '/app/harmonization-studio', icon: 'tune' },
  { name: 'Activity Calendar', path: '/app/activity-calendar', icon: 'calendar_today' },
  { name: 'Temporal Analysis', path: '/app/temporal-analysis', icon: 'trending_up' },
  { name: 'Sensor Comparison', path: '/app/sensor-comparison', icon: 'view_column' },
  { name: 'Data Laboratory', path: '/app/data-laboratory', icon: 'science' },
  { name: 'Reports', path: '/app/reports', icon: 'description' },
];

function isItemActive(item: NavItem, pathname: string): boolean {
  return item.path === '/app'
    ? pathname === '/app' || pathname === '/app/overview'
    : pathname.startsWith(item.path);
}

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const { data: status, loading, error } = useDatasetStatus();
  const datasetsLoaded = status?.datasetsLoaded ?? 0;

  // Below the lg breakpoint the sidebar becomes a drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Navigating always closes the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Escape closes; page behind does not scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  // Move focus into the drawer when it opens and back to the menu button when it closes.
  useEffect(() => {
    if (drawerOpen) {
      closeButtonRef.current?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      menuButtonRef.current?.focus();
      wasOpen.current = false;
    }
  }, [drawerOpen]);

  const apiState: 'connecting' | 'offline' | 'online' = loading ? 'connecting' : error ? 'offline' : 'online';
  const apiLabel = { connecting: 'Connecting…', offline: 'API offline', online: 'API online' }[apiState];
  const apiDot = { connecting: 'bg-outline', offline: 'bg-error', online: 'bg-validated' }[apiState];
  const datasetLabel = loading
    ? 'Checking datasets…'
    : error
      ? 'Dataset status unavailable'
      : datasetsLoaded > 0
        ? `${datasetsLoaded} dataset${datasetsLoaded === 1 ? '' : 's'} loaded`
        : 'No dataset loaded';

  const currentItem = navItems.find((item) => isItemActive(item, location.pathname));

  return (
    <div className="min-h-screen bg-surface font-body text-body-md text-on-surface antialiased">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to main content
      </a>

      {/* Drawer backdrop (mobile only) */}
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={cn(
          'fixed inset-0 z-40 bg-on-surface/40 transition-opacity duration-200 lg:hidden',
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Sidebar: fixed on desktop, slide-in drawer on small screens */}
      <aside
        id="app-sidebar"
        aria-label="Primary"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full w-[228px] select-none flex-col justify-between border-r border-border-grid bg-surface-container-lowest',
          'transition-[transform,visibility] duration-200 ease-out',
          'lg:visible lg:translate-x-0 lg:shadow-none',
          drawerOpen ? 'visible translate-x-0 shadow-drawer' : 'invisible -translate-x-full',
        )}
      >
        <div className="flex flex-col">
          <div className="flex h-16 items-center justify-between gap-3 border-b border-border-grid px-4">
            <Link to="/" className="flex min-w-0 items-center gap-3 rounded-lg" aria-label="FIRENEXUS home">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary shadow-card">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">local_fire_department</span>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-display text-[15px] font-extrabold leading-tight tracking-wide text-on-surface">FIRENEXUS</span>
                <span className="truncate font-body text-label-xs text-on-surface-variant">Satellite fire intelligence</span>
              </span>
            </Link>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container lg:hidden"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <p className="px-4 pb-2 pt-5 font-label-xs text-label-xs font-semibold text-outline">Modules</p>

          <nav aria-label="Modules" className="flex flex-col gap-0.5 px-2">
            {navItems.map((item) => {
              const active = isItemActive(item, location.pathname);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 items-center gap-3 rounded-lg px-3 font-body text-body-md transition-colors',
                    active
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                  )}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{item.icon}</span>
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Backend status */}
        <div className="flex flex-col gap-1.5 border-t border-border-grid p-4" role="status">
          <div className="flex items-center justify-between gap-2 font-body text-body-sm">
            <span className="flex items-center gap-2 text-on-surface">
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', apiDot)} />
              {apiLabel}
            </span>
            <span className="font-mono text-label-xs text-on-surface-variant">{status?.backendVersion ? `v${status.backendVersion}` : 'v—'}</span>
          </div>
          <p className="font-label-xs text-label-xs text-on-surface-variant">{datasetLabel}</p>
          <p className="font-label-xs text-label-xs text-outline">NASA Space Apps 2026</p>
        </div>
      </aside>

      {/* Main workspace */}
      <div className="flex w-full flex-col lg:pl-[228px]">
        <header className="fixed left-0 right-0 top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border-grid bg-surface-container-lowest px-4 lg:left-[228px] lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              aria-controls="app-sidebar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface hover:bg-surface-container lg:hidden"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[24px]">menu</span>
            </button>
            <span className="truncate font-body text-body-md font-semibold text-on-surface">{currentItem?.name ?? 'FIRENEXUS'}</span>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Badge tone={!loading && !error && datasetsLoaded > 0 ? 'success' : 'neutral'} dot className="hidden sm:inline-flex">
              {datasetLabel}
            </Badge>
            <span className="hidden font-mono text-label-xs text-on-surface-variant md:inline" title="Coordinate reference system">
              WGS 84 / EPSG:4326
            </span>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-h-screen w-full bg-surface pt-16 focus:outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
