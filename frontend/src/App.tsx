import React from 'react';
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

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <DatasetStatusProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/fire-explorer" element={<FireExplorer />} />
          <Route path="/harmonization-studio" element={<HarmonizationStudio />} />
          <Route path="/activity-calendar" element={<ActivityCalendar />} />
          <Route path="/temporal-analysis" element={<TemporalAnalysis />} />
          <Route path="/sensor-comparison" element={<SensorComparison />} />
          <Route path="/data-laboratory" element={<DataLaboratory />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </DatasetStatusProvider>
    </BrowserRouter>
  );
};

export default App;
