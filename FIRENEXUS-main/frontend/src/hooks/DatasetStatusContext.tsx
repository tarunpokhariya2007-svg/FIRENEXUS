import React, { createContext, useContext } from 'react';
import { api } from '../services/api';
import { DatasetStatus } from '../types/firenexus';
import { ApiResource, useApiResource } from './useApi';

const Ctx = createContext<ApiResource<DatasetStatus> | null>(null);

export const DatasetStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const resource = useApiResource(() => api.getDatasetStatus(), []);
  return <Ctx.Provider value={resource}>{children}</Ctx.Provider>;
};

export function useDatasetStatus(): ApiResource<DatasetStatus> {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDatasetStatus must be used inside DatasetStatusProvider');
  return v;
}
