import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Overview } from './pages/Overview';
import { FireExplorer } from './pages/FireExplorer';
import { HarmonizationStudio } from './pages/HarmonizationStudio';
import { ActivityCalendar } from './pages/ActivityCalendar';
import { TemporalAnalysis } from './pages/TemporalAnalysis';
import { SensorComparison } from './pages/SensorComparison';
import { DataLaboratory } from './pages/DataLaboratory';
import { Reports } from './pages/Reports';
import { DatasetStatusProvider } from './hooks/DatasetStatusContext';

const LandingPage = lazy(() => import('./pages/landing/LandingPage'));

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <DatasetStatusProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/app" element={<Navigate to="/app/overview" replace />} />
          <Route path="/app/overview" element={<Overview />} />
          <Route path="/app/fire-explorer" element={<FireExplorer />} />
          <Route path="/app/harmonization-studio" element={<HarmonizationStudio />} />
          <Route path="/app/activity-calendar" element={<ActivityCalendar />} />
          <Route path="/app/temporal-analysis" element={<TemporalAnalysis />} />
          <Route path="/app/sensor-comparison" element={<SensorComparison />} />
          <Route path="/app/data-laboratory" element={<DataLaboratory />} />
          <Route path="/app/reports" element={<Reports />} />
        </Route>
        <Route path="/" element={<Suspense fallback={<div className="landing-loading">Loading FIRENEXUS…</div>}><LandingPage /></Suspense>} />
        <Route path="/overview" element={<Navigate to="/app" replace />} />
        <Route path="/fire-explorer" element={<Navigate to="/app/fire-explorer" replace />} />
        <Route path="/harmonization-studio" element={<Navigate to="/app/harmonization-studio" replace />} />
        <Route path="/activity-calendar" element={<Navigate to="/app/activity-calendar" replace />} />
        <Route path="/temporal-analysis" element={<Navigate to="/app/temporal-analysis" replace />} />
        <Route path="/sensor-comparison" element={<Navigate to="/app/sensor-comparison" replace />} />
        <Route path="/data-laboratory" element={<Navigate to="/app/data-laboratory" replace />} />
        <Route path="/reports" element={<Navigate to="/app/reports" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </DatasetStatusProvider>
    </BrowserRouter>
  );
};

export default App;
