import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useDatasetStatus } from '../../hooks/DatasetStatusContext';

interface NavItem {
  name: string;
  path: string;
  icon: string;
}

const navItems: NavItem[] = [
  { name: 'Overview', path: '/', icon: 'dashboard' },
  { name: 'Fire Explorer', path: '/fire-explorer', icon: 'explore' },
  { name: 'Harmonization Studio', path: '/harmonization-studio', icon: 'tune' },
  { name: 'Activity Calendar', path: '/activity-calendar', icon: 'calendar_today' },
  { name: 'Temporal Analysis', path: '/temporal-analysis', icon: 'trending_up' },
  { name: 'Sensor Comparison', path: '/sensor-comparison', icon: 'view_column' },
  { name: 'Data Laboratory', path: '/data-laboratory', icon: 'science' },
  { name: 'Reports', path: '/reports', icon: 'description' },
];

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const { data: status, loading, error } = useDatasetStatus();
  const datasetsLoaded = status?.datasetsLoaded ?? 0;
  const backendState = loading ? 'CONNECTING' : error ? 'API OFFLINE' : datasetsLoaded > 0 ? 'DATA LOADED' : 'AWAITING DATASET';
  const backendColor = error ? 'bg-error' : datasetsLoaded > 0 ? 'bg-[#527A63]' : 'bg-outline';

  return (
    <div className="bg-surface font-body-md text-on-surface antialiased min-h-screen flex">
      {/* Sidebar (228px width per Stitch design) */}
      <aside className="fixed left-0 top-0 h-full w-[228px] bg-surface-container border-r border-surface-container-highest z-50 flex flex-col justify-between select-none">
        <div className="flex flex-col">
          {/* Logo Header */}
          <div className="h-16 px-space-md border-b border-surface-container-highest flex items-center gap-space-sm bg-surface-container">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-on-primary shrink-0 shadow-sm">
              <span className="material-symbols-outlined text-[20px]">local_fire_department</span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline-sm text-[15px] uppercase tracking-wider text-on-surface leading-tight font-semibold">
                FIRENEXUS
              </span>
              <span className="font-label-xs text-[10px] text-on-surface-variant uppercase tracking-widest font-mono">
                EARTH OBS • GIS
              </span>
            </div>
          </div>

          {/* Nav Header */}
          <div className="px-space-md pt-space-md pb-space-xs">
            <span className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium tracking-wider">
              Research Modules
            </span>
          </div>

          {/* Nav items */}
          <nav className="flex flex-col space-y-0.5 px-space-xs">
            {navItems.map((item) => {
              const isActive =
                item.path === '/'
                  ? location.pathname === '/' || location.pathname === '/overview'
                  : location.pathname.startsWith(item.path);

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-space-sm px-space-sm py-2 rounded transition-colors font-body-sm text-body-sm ${
                    isActive
                      ? 'bg-surface-container-highest text-on-surface border-l-2 border-primary font-medium'
                      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-primary' : ''}`}>
                    {item.icon}
                  </span>
                  <span>{item.name}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Telemetry Core status footer */}
        <div className="p-space-md border-t border-surface-container-highest bg-surface-container flex flex-col gap-space-xs">
          <div className="flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant">
            <span className="uppercase font-semibold">Telemetry Core</span>
            <span className={`inline-block w-2 h-2 rounded-full ${backendColor}`} title={backendState}></span>
          </div>
          <div className="font-label-xs text-[10px] text-on-surface-variant font-mono">{status?.backendVersion ? `v${status.backendVersion}` : 'v—'}</div>
          <div className={`font-label-xs text-[10px] font-mono font-medium ${error ? 'text-error' : datasetsLoaded > 0 ? 'text-[#527A63]' : 'text-on-surface-variant'}`}>{backendState}</div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <div className="pl-[228px] w-full flex flex-col">
        {/* Top Operational Header */}
        <header className="fixed top-0 left-[228px] right-0 h-16 bg-surface-container-lowest border-b border-surface-container-highest z-40 flex items-center justify-between px-space-lg select-none">
          {/* Left Breadcrumbs & AOI indicator */}
          <div className="flex items-center gap-space-md overflow-hidden">
            <div className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <span className="hover:text-on-surface cursor-pointer">Platform</span>
              <span className="text-on-surface-variant">/</span>
              <span className="text-on-surface font-medium">Earth Observation</span>
            </div>
            <div className="h-4 w-px bg-surface-container-highest"></div>
            <div className="flex items-center gap-space-xs px-space-sm py-0.5 rounded bg-surface-container-high border border-surface-container-highest">
              <span className="material-symbols-outlined text-[14px] text-tertiary">public</span>
              <span className="font-label-xs text-label-xs text-on-surface font-medium uppercase font-mono">
                AOI: not set | {datasetsLoaded > 0 ? `${datasetsLoaded} dataset(s)` : 'No dataset loaded'}
              </span>
            </div>
          </div>

          {/* Right System Telemetry & Profile */}
          <div className="flex items-center gap-space-md">
            <div className="hidden xl:flex items-center gap-space-xs px-space-sm py-1 rounded bg-surface-container text-on-surface border border-surface-container-highest">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary-container"></span>
              <span className="font-label-xs text-label-xs font-mono">
                MODIS / VIIRS • {datasetsLoaded > 0 ? `${datasetsLoaded} dataset(s) loaded` : 'Awaiting NASA dataset'}
              </span>
            </div>
            <div className="hidden lg:flex items-center gap-space-xs px-space-sm py-1 rounded bg-surface-container border border-surface-container-highest font-label-xs text-label-xs text-on-surface-variant font-mono">
              <span className="material-symbols-outlined text-[14px]">grid_4x4</span>
              <span>WGS 84 / EPSG:4326</span>
            </div>
            <div className="flex items-center px-space-sm py-1 rounded bg-secondary-fixed text-on-secondary-fixed-variant font-label-xs text-label-xs border border-secondary font-medium uppercase tracking-wider font-mono">
              NASA Space Apps 2026
            </div>
          </div>
        </header>

        {/* Dynamic Route Content */}
        <main className="w-full pt-16 bg-surface min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
