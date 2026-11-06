import React, { useRef, useState } from 'react';
import { api } from '../services/api';
import { DatasetMetadata, FireObservation, SchemaValidationResult, SensorType } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { AWAITING_NASA, EMPTY, NO_DATASET, fmtInt } from '../utils/format';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StatePanel';

export const DataLaboratory: React.FC = () => {
  const inventoryRes = useApiResource(() => api.getDatasets(), []);
  const datasets: DatasetMetadata[] = inventoryRes.data?.datasets ?? [];
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadReport, setUploadReport] = useState<Record<string, unknown> | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Schema validation (reads only the CSV header locally; the backend checks it against the FIRMS layout)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [validationSensor, setValidationSensor] = useState<SensorType>('MODIS');
  const [linterActive, setLinterActive] = useState<boolean>(false);
  const [validation, setValidation] = useState<SchemaValidationResult | null>(null);
  const [validationFile, setValidationFile] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const currentDataset: DatasetMetadata | null = datasets.find((d) => d.id === selectedDatasetId) ?? datasets[0] ?? null;
  const previewRes = useApiResource(
    () => currentDataset ? api.getDatasetObservations(currentDataset.id, 0, 200) : Promise.resolve([]),
    [currentDataset?.id],
  );
  const activeVar = currentDataset?.variables.find((v) => v.name === selectedVariable) ?? currentDataset?.variables[0] ?? null;
  const noDataset = inventoryRes.data?.status === 'no_dataset';

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setPendingFile(file);
    setUploadError(null);
    setUploadNotice(null);
    setLinterActive(true);
    setValidation(null);
    setValidationError(null);
    setValidationFile(file.name);
    try {
      const headerText = await file.slice(0, 64 * 1024).text();
      const firstLine = headerText.split(/\r?\n/)[0] ?? '';
      const columns = firstLine.replace(/^\uFEFF/, '').split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter((c) => c.length > 0);
      if (columns.length === 0) throw new Error('The file has no header row.');
      setValidation(await api.validateSchema(validationSensor, columns));
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setLinterActive(false);
    }
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    void handleFile(file);
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    setUploadNotice(null);
    try {
      const result = await api.uploadDataset(pendingFile, validationSensor, setUploadProgress);
      setUploadNotice(result.message);
      setUploadReport(result.dataset.qualityReport ?? null);
      setSelectedDatasetId(result.dataset.id);
      setPendingFile(null);
      inventoryRes.reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Dataset import failed');
    } finally {
      setUploading(false);
    }
  };

  const removeDataset = async () => {
    if (!currentDataset || !window.confirm(`Remove ${currentDataset.title} and its stored files?`)) return;
    try {
      await api.deleteDataset(currentDataset.id);
      setSelectedDatasetId(null);
      setUploadNotice(`Removed ${currentDataset.title}.`);
      inventoryRes.reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Dataset removal failed');
    }
  };

  const previewRows: FireObservation[] = previewRes.data ?? [];

  const completeness = (() => {
    const items = currentDataset?.missingValueAnalysis ?? [];
    if (items.length === 0) return null;
    const total = items.reduce((n, i) => n + i.totalRows, 0);
    const missing = items.reduce((n, i) => n + i.missingCount, 0);
    return total > 0 ? ((total - missing) / total) * 100 : null;
  })();
  const dtypeSummary = (currentDataset?.variables ?? []).reduce<Record<string, number>>((acc, v) => {
    acc[v.dtype] = (acc[v.dtype] ?? 0) + 1;
    return acc;
  }, {});

  if (inventoryRes.loading && !inventoryRes.data) {
    return <LoadingState className="p-space-lg min-h-[500px]" label="LOADING DATA LABORATORY CATALOG..." />;
  }
  if (inventoryRes.error) {
    return <ErrorState className="m-space-lg min-h-[500px]" error={inventoryRes.error} onRetry={inventoryRes.reload} />;
  }
  const sampleRows = previewRows;
  const q = searchTerm.toLowerCase();
  const filteredRows = sampleRows.filter((r) => r.platform.toLowerCase().includes(q) || String(r.frp ?? '').includes(searchTerm) || String(r.latitude).includes(searchTerm));

  return (
    <div className="flex flex-col w-full font-mono">
      {/* Research Subheader / Telemetry Status Bar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-space-sm px-space-lg py-space-sm bg-surface-container border-b border-structural">
        <div className="flex flex-col sm:flex-row sm:items-center gap-space-md">
          <div className="flex items-center gap-space-xs">
            <span className="px-space-xs py-0.5 rounded bg-surface-container-highest font-label-xs text-label-xs text-on-surface uppercase tracking-wider font-semibold">
              MODULE 07
            </span>
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Dataset Inspection &amp; Pipeline Repository
            </span>
          </div>
          <div className="hidden md:flex items-center gap-space-xs text-on-surface-variant font-label-xs text-label-xs">
            <span className="w-1 h-1 rounded-full bg-outline"></span>
            <span>DATASET INVENTORY &amp; SCHEMA VALIDATION</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-space-sm font-label-xs text-label-xs">
          <div className="flex items-center gap-space-xs px-space-sm py-1 rounded bg-surface-container-lowest text-on-surface border border-structural">
            <span className="inline-block w-2 h-2 rounded-full bg-secondary"></span>
            <span className="text-on-surface-variant">DATASETS:</span>
            <span className="font-semibold">{datasets.length}</span>
            <span className="text-on-surface-variant">|</span>
            <span className="text-on-surface-variant">STATUS:</span>
            <span className="font-semibold text-secondary">{noDataset ? 'NO DATASET LOADED' : 'LOADED'}</span>
          </div>

          <div className="flex items-center gap-1">
            <select
              aria-label="Sensor schema to validate against"
              value={validationSensor}
              onChange={(e) => { setValidationSensor(e.target.value as SensorType); setValidation(null); }}
              className="px-space-sm py-1 rounded bg-surface-container-lowest text-on-surface outline-none cursor-pointer"
            >
              <option value="MODIS">MODIS layout</option>
              <option value="VIIRS">VIIRS layout</option>
            </select>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChosen} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={linterActive}
              className="px-space-sm py-1 rounded bg-surface-container-lowest hover:bg-surface-container-high text-on-surface font-medium flex items-center gap-1 transition-colors disabled:opacity-60"
            >
              <span className={`material-symbols-outlined text-[14px] text-tertiary ${linterActive ? 'animate-spin' : ''}`}>fact_check</span>
              <span>{linterActive ? 'Validating Schema...' : 'Validate CSV Schema'}</span>
            </button>
            <button
              disabled
              title="Export is available once a dataset is loaded"
              className="px-space-sm py-1 rounded bg-primary text-on-primary font-medium flex items-center gap-1 opacity-50 cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[14px]">download</span>
              <span>Export Subset</span>
            </button>
          </div>
        </div>
      </div>

      <section
        aria-label="NASA FIRMS CSV import"
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); void handleFile(e.dataTransfer.files?.[0]); }}
        className={`mx-space-lg mt-space-sm p-space-md border border-dashed rounded flex flex-col md:flex-row md:items-center justify-between gap-space-sm ${dragActive ? 'bg-primary-fixed border-primary' : 'bg-surface-container-lowest border-structural'}`}
      >
        <div className="flex flex-col gap-1">
          <span className="font-label-sm text-label-sm text-on-surface font-semibold">Import NASA FIRMS CSV</span>
          <span className="font-label-xs text-label-xs text-on-surface-variant">Drop a MODIS or VIIRS CSV here, or choose a file above. Review the schema result, then confirm import.</span>
          {pendingFile && <span className="font-label-xs text-label-xs text-primary">Selected: {pendingFile.name} ({(pendingFile.size / 1024 / 1024).toFixed(2)} MB)</span>}
          {uploading && <div className="w-full md:w-64 h-1.5 bg-surface-container-high rounded"><div className="h-full bg-primary rounded transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
        </div>
        <div className="flex items-center gap-space-sm">
          <button onClick={() => fileInputRef.current?.click()} className="px-space-sm py-1.5 rounded bg-surface-container-high text-on-surface font-label-xs text-label-xs">Choose CSV</button>
          <button onClick={() => void confirmUpload()} disabled={!pendingFile || !validation?.valid || uploading} className="px-space-sm py-1.5 rounded bg-primary text-on-primary font-label-xs text-label-xs disabled:opacity-50">{uploading ? `Uploading ${uploadProgress}%` : 'Confirm import'}</button>
        </div>
      </section>
      {(uploadError || uploadNotice) && <div role="status" className={`px-space-lg py-space-sm font-label-xs text-label-xs ${uploadError ? 'text-error' : 'text-secondary'}`}>{uploadError ?? uploadNotice}</div>}
      {uploadReport && (
        <div className="mx-space-lg mb-space-sm p-space-sm rounded bg-surface-container-low border border-structural font-label-xs text-label-xs text-on-surface-variant">
          Import report: {String(uploadReport.totalInputRows ?? 0)} input rows · {String(uploadReport.successfullyParsedRows ?? 0)} parsed · {String(uploadReport.rejectedRows ?? 0)} rejected · {String(uploadReport.duplicateRecords ?? 0)} duplicate rows.
          {typeof uploadReport.rejectionReasons === 'object' && uploadReport.rejectionReasons !== null ? <span> Reasons: {Object.entries(uploadReport.rejectionReasons as Record<string, number>).map(([reason, count]) => `${reason} ${count}`).join(', ') || 'none'}.</span> : null}
        </div>
      )}

      {(validation || validationError) && (
        <div role="status" className="px-space-lg py-space-sm bg-surface-container-low border-b border-structural font-mono text-[11px]">
          {validationError ? (
            <span className="text-error">Schema validation failed: {validationError}</span>
          ) : validation ? (
            <div className="flex flex-col gap-0.5">
              <span className={validation.valid ? 'text-[#527A63] font-semibold' : 'text-error font-semibold'}>
                {validationFile}: {validation.valid ? 'VALID' : 'INVALID'} — {validation.message}
              </span>
              {validation.missingRequired.length > 0 && <span className="text-on-surface-variant">Missing: {validation.missingRequired.join(', ')}</span>}
              {validation.unexpectedColumns.length > 0 && <span className="text-on-surface-variant">Unexpected: {validation.unexpectedColumns.join(', ')}</span>}
              {validation.duplicateColumns.length > 0 && <span className="text-on-surface-variant">Duplicate: {validation.duplicateColumns.join(', ')}</span>}
            </div>
          ) : null}
        </div>
      )}

      {/* Top Metrics / Dataset Inventory Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-surface-container-highest border-b border-structural">
        {/* Active Container */}
        <div className="bg-surface-container-lowest p-space-md flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-xs text-label-xs uppercase text-on-surface-variant tracking-wider">
              Active Storage Container
            </span>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-surface-container-high font-label-xs text-label-xs text-on-surface font-semibold">
                {currentDataset ? 'LOADED' : 'EMPTY'}
              </span>
              {currentDataset && <button onClick={() => void removeDataset()} className="text-error font-label-xs text-label-xs underline">Remove</button>}
            </div>
          </div>
          <div className="mt-space-xs">
            <div className="font-label-md text-label-md font-semibold text-on-surface truncate">
              {currentDataset?.title ?? NO_DATASET}
            </div>
            <div className="flex items-center gap-space-xs mt-1 font-label-xs text-label-xs text-on-surface-variant">
              <span className="text-tertiary font-medium">{currentDataset?.fileFormat ?? EMPTY}</span>
              <span>•</span>
              <span>Volume: {currentDataset?.sizeMb != null ? `${(currentDataset.sizeMb / 1024).toFixed(2)} GB` : EMPTY}</span>
            </div>
          </div>
        </div>

        {/* Granules & Layout */}
        <div className="bg-surface-container-lowest p-space-md flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-xs text-label-xs uppercase text-on-surface-variant tracking-wider">
              Granules &amp; Layout
            </span>
            <span className="font-label-xs text-label-xs text-secondary font-medium">{currentDataset?.sensor ?? EMPTY}</span>
          </div>
          <div className="mt-space-xs">
            <div className="font-label-md text-label-md font-semibold text-on-surface flex items-baseline gap-space-xs">
              <span>{fmtInt(currentDataset?.recordCount)} Records</span>
              
            </div>
            <div className="flex items-center gap-space-xs mt-1 font-label-xs text-label-xs text-on-surface-variant">
              <span>Coverage: {currentDataset?.temporalCoverage ?? EMPTY}</span>
              <span>•</span>
              <span className="text-primary font-medium">{currentDataset?.spatialResolution ?? EMPTY}</span>
            </div>
          </div>
        </div>

        {/* Telemetry Variables */}
        <div className="bg-surface-container-lowest p-space-md flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-xs text-label-xs uppercase text-on-surface-variant tracking-wider">
              Variables &amp; Bitfields
            </span>
            <span className="font-label-xs text-label-xs text-tertiary font-medium">{currentDataset?.cfVersion ?? EMPTY}</span>
          </div>
          <div className="mt-space-xs">
            <div className="font-label-md text-label-md font-semibold text-on-surface flex items-baseline gap-space-xs">
              <span>{currentDataset ? currentDataset.variables.length : EMPTY} Registered Variables</span>
              
            </div>
            <div className="flex items-center gap-space-xs mt-1 font-label-xs text-label-xs text-on-surface-variant">
              <span>{Object.keys(dtypeSummary).length ? Object.entries(dtypeSummary).map(([k, n]) => `${k}: ${n}`).join(' • ') : EMPTY}</span>
            </div>
          </div>
        </div>

        {/* Data Integrity */}
        <div className="bg-surface-container-lowest p-space-md flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-xs text-label-xs uppercase text-on-surface-variant tracking-wider">
              Integrity Audit
            </span>
            <span className="flex items-center gap-1 font-label-xs text-label-xs text-primary font-semibold">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${completeness !== null ? 'bg-primary' : 'bg-outline'}`}></span>
              {completeness !== null ? 'AUDITED' : 'NOT AUDITED'}
            </span>
          </div>
          <div className="mt-space-xs">
            <div className="font-label-md text-label-md font-semibold text-on-surface flex items-baseline gap-space-xs">
              <span>{completeness !== null ? `${completeness.toFixed(2)}% Complete` : EMPTY}</span>
              
            </div>
            <div className="flex items-center gap-space-xs mt-1 font-label-xs text-label-xs text-on-surface-variant">
              <span>{completeness !== null ? `Null rate: ${(100 - completeness).toFixed(2)}%` : 'Requires a loaded dataset'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* WORKSPACE SPLIT (Left: HDF5 Tree & Variable Inspector, Right: Lab Previews & Analysis) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-14rem)] bg-surface-container-high gap-px">
        {/* LEFT COLUMN: TREE BROWSER & VARIABLE INSPECTOR (5 cols) */}
        <div className="lg:col-span-5 bg-surface flex flex-col justify-between border-r border-structural">
          <div className="flex flex-col">
            {/* Dataset Selector Tabs */}
            <div className="p-space-sm bg-surface-container-low border-b border-structural flex gap-1">
              {datasets.length === 0 && <span className="px-2 py-1 text-label-xs text-on-surface-variant">{NO_DATASET}</span>}
              {datasets.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDatasetId(d.id)}
                  className={`px-2 py-1 rounded text-label-xs transition-colors truncate flex-1 text-left ${
                    currentDataset?.id === d.id
                      ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-sm border border-structural'
                      : 'text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {d.satellite?.split(' ')[0] ?? d.sensor} {d.instrument?.slice(0, 5) ?? ''}
                </button>
              ))}
            </div>

            {/* Tree Header */}
            <div className="px-space-md py-2.5 bg-surface-container border-b border-structural flex items-center justify-between select-none">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">account_tree</span>
                <span className="font-headline-sm text-headline-sm uppercase tracking-wide text-on-surface font-semibold">
                  Hierarchical Schema Browser
                </span>
              </div>
              <span className="font-label-xs text-[10px] text-on-surface-variant uppercase px-1.5 py-0.5 rounded bg-surface-container-high">
                HDF5 Group Tree
              </span>
            </div>

            {/* Tree View Container */}
            <div className="p-space-sm overflow-y-auto max-h-[340px] bg-surface select-none font-label-sm text-label-sm">
              {/* Root */}
              <div className="flex items-center gap-1 py-1 px-1.5 rounded hover:bg-surface-container text-on-surface font-medium cursor-pointer">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">folder_open</span>
                <span className="font-semibold text-on-surface">/ (root group)</span>
                <span className="ml-auto font-label-xs text-label-xs text-on-surface-variant">{currentDataset ? Object.keys(currentDataset.attributes).length : 0} attributes</span>
              </div>

              {/* Global attributes */}
              <div className="pl-4 border-l border-structural ml-2 my-0.5 space-y-0.5">
                {currentDataset && Object.entries(currentDataset.attributes).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-0.5 px-1 hover:bg-surface-container rounded text-[11px] text-on-surface-variant">
                    <span>{k}</span>
                    <span className="truncate max-w-[55%]">{v}</span>
                  </div>
                ))}
              </div>
              {/* Variables */}
              <div className="pl-4 border-l border-structural ml-2 my-0.5 space-y-0.5">
                <div className="flex items-center gap-1 py-1 px-1.5 rounded bg-surface-container-high text-on-surface cursor-pointer font-medium">
                  <span className="material-symbols-outlined text-[15px] text-primary">folder_open</span>
                  <span className="font-semibold text-primary">data_variables</span>
                  <span className="ml-auto font-label-xs text-[10px] px-1 rounded bg-primary-fixed text-on-primary-fixed font-semibold">
                    {currentDataset?.variables.length ?? 0} VARS
                  </span>
                </div>
                <div className="pl-4 border-l border-primary ml-2 flex flex-col space-y-0.5">
                  {(currentDataset?.variables ?? []).map((v) => (
                    <div
                      key={v.name}
                      onClick={() => setSelectedVariable(v.name)}
                      className={`flex items-center justify-between py-1 px-1.5 rounded cursor-pointer transition-colors ${
                        (activeVar?.name === v.name)
                          ? 'bg-primary text-on-primary font-medium shadow-sm'
                          : 'hover:bg-surface-container text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">insights</span>
                        {v.name}
                      </span>
                      <span className="font-label-xs text-[10px] opacity-80">{v.dtype}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Variable Metadata Inspector Bottom */}
          <div className="p-space-md bg-surface-container-low border-t border-structural">
            <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider block mb-2 font-semibold">
              Variable Metadata Inspector: <strong className="text-on-surface">{activeVar?.name ?? EMPTY}</strong>
            </span>
            {activeVar ? (
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-surface-container-lowest p-2.5 rounded border border-structural">
                <div><span className="text-on-surface-variant">Standard Name:</span> <strong className="text-on-surface">{activeVar.standardName ?? EMPTY}</strong></div>
                <div><span className="text-on-surface-variant">Data Type:</span> <strong className="text-on-surface">{activeVar.dtype}</strong></div>
                <div><span className="text-on-surface-variant">Units:</span> <strong className="text-primary">{activeVar.units ?? EMPTY}</strong></div>
                <div><span className="text-on-surface-variant">FillValue:</span> <strong className="text-on-surface">{activeVar.fillValue ?? EMPTY}</strong></div>
                <div className="col-span-2"><span className="text-on-surface-variant">Valid Range:</span> <strong className="text-on-surface">{activeVar.validRange ?? EMPTY}</strong></div>
              </div>
            ) : (
              <EmptyState compact title={NO_DATASET} detail={AWAITING_NASA} />
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: OBSERVATION MATRIX & QUALITY AUDIT (7 cols) */}
        <div className="lg:col-span-7 bg-surface p-space-md flex flex-col gap-space-md">
          {/* Top Search & Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-lowest p-space-sm rounded shadow-sm border border-structural">
            <div className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded flex-1 max-w-sm border border-structural">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">search</span>
              <input
                type="text"
                placeholder="Search raw observations by coordinates, sensor or FRP..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-transparent text-[11px] text-on-surface outline-none w-full"
              />
            </div>
            <div className="flex items-center gap-space-xs text-[11px] text-on-surface-variant">
              <span>Showing: <strong className="text-on-surface">{filteredRows.length}</strong> records</span>
            </div>
          </div>

          {/* Raw Data Preview Table */}
          <div className="bg-surface-container-lowest rounded shadow-sm overflow-hidden flex flex-col border border-structural">
            <div className="p-space-sm bg-surface-container-low flex justify-between items-center border-b border-structural">
              <span className="font-label-sm text-label-sm font-semibold uppercase text-on-surface">
                Observation Record Inspector (CSV / Table Grid)
              </span>
              <span className="text-label-xs text-[10px] text-on-surface-variant">
                FIRST 200 RECORDS
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="bg-surface-container text-on-surface-variant uppercase">
                    <th className="py-1.5 px-2">#</th>
                    <th className="py-1.5 px-2">Latitude</th>
                    <th className="py-1.5 px-2">Longitude</th>
                    <th className="py-1.5 px-2">Timestamp (UTC)</th>
                    <th className="py-1.5 px-2 text-right">FRP (MW)</th>
                    <th className="py-1.5 px-2 text-right">Conf (%)</th>
                    <th className="py-1.5 px-2">Platform</th>
                    <th className="py-1.5 px-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {previewRes.error && (
                    <tr><td colSpan={8}><ErrorState className="p-space-sm" error={previewRes.error} onRetry={previewRes.reload} /></td></tr>
                  )}
                  {previewRes.loading && !previewRes.data && (
                    <tr><td colSpan={8}><LoadingState className="p-space-md" label="LOADING DATASET PREVIEW..." /></td></tr>
                  )}
                  {!previewRes.error && !previewRes.loading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState compact title={datasets.length === 0 ? NO_DATASET : currentDataset?.recordCount === 0 ? 'No valid observations imported' : 'No matching records'} detail={datasets.length === 0 ? AWAITING_NASA : currentDataset?.recordCount === 0 ? 'Review the import report for rejected rows.' : 'Adjust the search term'} />
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="py-1.5 px-2 text-on-surface-variant">{idx + 1}</td>
                      <td className="py-1.5 px-2">{row.latitude.toFixed(4)}</td>
                      <td className="py-1.5 px-2">{row.longitude.toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-on-surface-variant">{row.acq_date} {row.acq_time.padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2')}</td>
                      <td className="py-1.5 px-2 text-right font-bold text-primary">{row.frp !== null ? row.frp.toFixed(1) : EMPTY}</td>
                      <td className="py-1.5 px-2 text-right">{row.confidence !== null ? `${row.confidence}%` : row.confidence_class ?? EMPTY}</td>
                      <td className="py-1.5 px-2">{row.platform}</td>
                      <td className="py-1.5 px-2 text-center">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-surface-container-high text-on-surface-variant">
                          {row.harmonization_status.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Missing Value Audit & Quality Analysis */}
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm border border-structural">
            <div className="flex items-center justify-between">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Missing-Value &amp; Null FillRate Audit
              </span>
              <span className="text-[10px] text-secondary font-bold">{completeness !== null ? `COMPLETENESS ${completeness.toFixed(2)}%` : 'NOT AUDITED'}</span>
            </div>

            <div className="space-y-1.5 pt-1 text-[11px]">
              {(currentDataset?.missingValueAnalysis ?? []).length === 0 && <EmptyState compact title={NO_DATASET} detail="No missing-value audit available" />}
              {(currentDataset?.missingValueAnalysis ?? []).map((item) => (
                <div key={item.column} className="flex items-center gap-2">
                  <span className="w-24 text-on-surface-variant truncate">{item.column}</span>
                  <div className="flex-1 bg-surface-container h-3 rounded-xs overflow-hidden flex">
                    <div
                      style={{ width: `${Math.max(1, 100 - item.missingPercentage)}%` }}
                      className="bg-[#527A63] h-full"
                    />
                    {item.missingPercentage > 0 && (
                      <div
                        style={{ width: `${item.missingPercentage}%` }}
                        className="bg-error h-full"
                      />
                    )}
                  </div>
                  <span className="w-20 text-right text-on-surface font-medium">
                    {`${item.missingPercentage.toFixed(2)}% null`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
