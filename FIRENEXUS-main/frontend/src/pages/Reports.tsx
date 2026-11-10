import React, { useState } from 'react';
import { api, ApiError } from '../services/api';
import { ScientificReport } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { AWAITING_NASA, EMPTY } from '../utils/format';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StatePanel';

const SECTION_LABELS: Record<string, { title: string; hint: string }> = {
  'harmonization-summary': { title: 'Harmonization summary', hint: 'Input counts and match outcomes from the latest completed job' },
  'cross-sensor-agreement': { title: 'Cross-sensor FRP agreement', hint: 'Correlation of coincident MODIS and VIIRS FRP' },
  provenance: { title: 'Provenance', hint: 'Source job and SHA-256 digest of its parameters and results' },
};

export const Reports: React.FC = () => {
  const availabilityRes = useApiResource(() => api.getReportAvailability(), []);
  const availability = availabilityRes.data;

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [selectedSections, setSelectedSections] = useState<string[] | null>(null);
  const [report, setReport] = useState<ScientificReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<ApiError | null>(null);

  const sections = availability?.availableSections ?? [];
  const chosen = selectedSections ?? sections;
  const canGenerate = !!availability?.canGenerate && chosen.length > 0 && !isGenerating;
  const disabledReason = availabilityRes.error
    ? `Cannot verify analysis availability: ${availabilityRes.error.message}`
    : !availability
    ? 'Checking analysis availability…'
    : !availability.canGenerate
    ? availability.reason
    : chosen.length === 0
    ? 'Select at least one section.'
    : null;

  const toggleSection = (id: string) =>
    setSelectedSections((cur) => {
      const base = cur ?? sections;
      return base.includes(id) ? base.filter((s) => s !== id) : [...base, id];
    });

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      setReport(await api.generateReport({ title: title.trim(), author: author.trim(), includeSections: chosen }));
    } catch (e) {
      setReport(null);
      setGenerateError(e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : 'Unexpected error', 0));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportPdf = () => {
    if (!report) return;
    window.print();
  };

  const handleExportJson = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.reportId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (availabilityRes.loading && !availability) {
    return <LoadingState className="p-space-lg min-h-[500px]" label="CHECKING AVAILABLE ANALYSES..." />;
  }

  const statusLabel = generateError ? 'GENERATION FAILED' : report ? 'GENERATED' : availability?.canGenerate ? 'READY TO GENERATE' : 'NO VALID ANALYSIS';
  const statusDot = generateError ? 'bg-error' : report || availability?.canGenerate ? 'bg-primary' : 'bg-outline';

  return (
    <div className="flex flex-col w-full font-mono">
      {/* Interactive Top Action / Subheader Strip */}
      <div className="w-full bg-surface-container-low px-space-lg py-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-md border-b border-structural">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="font-label-xs text-label-xs uppercase tracking-wider px-space-xs py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-medium">
              Module 08
            </span>
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Scientific Synthesis &amp; Provenance Registry
            </span>
            <span className="inline-flex items-center gap-1 px-space-xs py-0.5 rounded bg-surface-container-high text-tertiary font-label-xs text-label-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`}></span>
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-space-md text-on-surface-variant font-label-xs text-label-xs mt-0.5">
            <span>Source: <strong className="text-on-surface font-medium">{report ? report.sourceJobId : 'no analysis'}</strong></span>
            <span>•</span>
            <span>SHA-256: <strong className="text-on-surface font-medium">{report ? `${report.provenanceHash.slice(0, 12)}…` : EMPTY}</strong></span>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-space-xs flex-wrap">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            title={disabledReason ?? undefined}
            className="inline-flex items-center gap-1.5 px-space-md py-1.5 rounded bg-primary text-on-primary font-body-sm text-body-sm shadow-sm hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={`material-symbols-outlined text-[16px] ${isGenerating ? 'animate-spin' : ''}`}>{isGenerating ? 'sync' : 'description'}</span>
            <span className="font-medium">{isGenerating ? 'Generating…' : 'Generate Report'}</span>
          </button>
          <button
            onClick={handleExportPdf}
            disabled={!report}
            title={report ? 'Print or save as PDF' : 'Generate a report first'}
            className="inline-flex items-center gap-1.5 px-space-sm py-1.5 rounded bg-surface-container-lowest text-on-surface font-body-sm text-body-sm hover:bg-surface-container transition-colors border border-structural disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">picture_as_pdf</span>
            <span>Print / PDF</span>
          </button>
          <button
            onClick={handleExportJson}
            disabled={!report}
            title={report ? 'Download the report as JSON' : 'Generate a report first'}
            className="inline-flex items-center gap-1.5 px-space-sm py-1.5 rounded bg-surface-container-lowest text-on-surface font-body-sm text-body-sm hover:bg-surface-container transition-colors border border-structural disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">data_object</span>
            <span>JSON</span>
          </button>
        </div>
      </div>

      {(disabledReason && !report) && (
        <div role="status" className="w-full px-space-lg py-1 bg-surface-container text-on-surface-variant font-label-xs text-label-xs border-b border-structural">
          {disabledReason}
        </div>
      )}
      {generateError && (
        <div role="alert" className="w-full px-space-lg py-1 bg-error-container text-on-error-container font-label-xs text-label-xs">
          {generateError.message}
        </div>
      )}
      {availabilityRes.error && <ErrorState className="m-space-md" error={availabilityRes.error} onRetry={availabilityRes.reload} />}

      {/* Main Viewport Layout: Two Panel Structure */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md p-space-md w-full items-start">
        {/* LEFT PANEL: Configuration & Manifest (4 cols) */}
        <div className="xl:col-span-4 flex flex-col gap-space-md min-w-0">
          {/* Report configuration */}
          <div className="bg-surface-container-lowest rounded p-space-md flex flex-col gap-space-sm shadow-sm border border-structural">
            <div className="flex items-center justify-between pb-space-xs bg-surface-container-low px-space-sm py-1 rounded border border-structural">
              <span className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                Report Configuration
              </span>
              <span className="font-label-xs text-label-xs text-primary font-medium">{availability?.canGenerate ? 'ANALYSIS AVAILABLE' : 'NO ANALYSIS'}</span>
            </div>
            <div className="space-y-space-xs pt-1">
              <label className="block font-label-xs text-label-xs text-on-surface-variant uppercase" htmlFor="report-title">
                Title
              </label>
              <input
                id="report-title"
                type="text"
                maxLength={300}
                placeholder="Defaults to the source job id"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-surface-container p-space-sm rounded border border-structural font-body-sm text-body-sm text-on-surface outline-none"
              />
            </div>
            <div className="space-y-space-xs">
              <label className="block font-label-xs text-label-xs text-on-surface-variant uppercase" htmlFor="report-author">
                Author (optional)
              </label>
              <input
                id="report-author"
                type="text"
                maxLength={200}
                placeholder="Left blank unless you enter one"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full bg-surface-container p-space-sm rounded border border-structural font-body-sm text-body-sm text-on-surface outline-none"
              />
            </div>
          </div>

          {/* Report Section Composition Checklist */}
          <div className="bg-surface-container-lowest rounded p-space-md flex flex-col gap-space-sm shadow-sm border border-structural">
            <div className="flex items-center justify-between bg-surface-container-low px-space-sm py-1 rounded border border-structural">
              <span className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                Manuscript Architecture
              </span>
              <span className="font-label-xs text-label-xs text-on-surface-variant font-medium">
                {chosen.length}/{sections.length} Sections Selected
              </span>
            </div>
            <div className="space-y-1.5">
              {sections.length === 0 && <EmptyState compact title="No sections available" detail="Sections appear once an analysis has been completed" icon="article" />}
              {sections.map((id) => (
                <label
                  key={id}
                  className="flex items-start gap-2 p-1.5 rounded bg-surface-container-low hover:bg-surface-container transition-colors border border-structural cursor-pointer"
                >
                  <input type="checkbox" checked={chosen.includes(id)} onChange={() => toggleSection(id)} className="mt-1 accent-primary" />
                  <div className="flex flex-col">
                    <span className="font-body-sm text-body-sm text-on-surface font-medium leading-tight">{SECTION_LABELS[id]?.title ?? id}</span>
                    <span className="font-label-xs text-[10px] text-on-surface-variant">{SECTION_LABELS[id]?.hint ?? ''}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Provenance Badge */}
          <div className="bg-surface-container-lowest rounded p-space-md flex flex-col gap-space-sm shadow-sm border border-structural">
            <div className="flex items-center justify-between bg-surface-container-low px-space-sm py-1 rounded border border-structural">
              <span className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                Provenance Manifest
              </span>
              <span className="inline-flex items-center gap-1 font-label-xs text-label-xs text-secondary">
                <span className="material-symbols-outlined text-[12px]">lock</span>
                {report ? 'Digest computed' : 'Not generated'}
              </span>
            </div>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between py-1 bg-surface-container px-2 rounded border border-structural">
                <span className="text-on-surface-variant">Author</span>
                <span className="text-on-surface font-medium">{report?.author ?? EMPTY}</span>
              </div>
              <div className="flex justify-between py-1 bg-surface-container px-2 rounded border border-structural">
                <span className="text-on-surface-variant">Source job</span>
                <span className="text-on-surface font-medium">{report?.sourceJobId ?? EMPTY}</span>
              </div>
              <div className="flex justify-between py-1 bg-surface-container px-2 rounded border border-structural">
                <span className="text-on-surface-variant">Digest Hash (SHA-256)</span>
                <span className="text-primary font-mono text-[10px] truncate max-w-[180px]">{report?.provenanceHash ?? EMPTY}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Manuscript Preview (8 cols) */}
        <div className="xl:col-span-8 bg-surface-container-lowest rounded p-space-xl flex flex-col gap-space-lg shadow-sm border border-structural">
          {!report ? (
            isGenerating ? (
              <LoadingState className="py-space-xl" label="GENERATING REPORT..." />
            ) : (
              <EmptyState
                title={availability?.canGenerate ? 'No report generated yet' : 'No valid analysis exists'}
                detail={availability?.canGenerate ? 'Configure the report and press Generate Report' : `${AWAITING_NASA}. Run harmonization on loaded datasets first.`}
                icon="description"
                className="py-space-xl"
              />
            )
          ) : (
            <>
              {/* Header Block */}
              <div className="border-b border-structural pb-space-md flex flex-col gap-space-xs font-sans">
                <div className="flex items-center justify-between text-label-xs text-on-surface-variant font-mono">
                  <span>FIRENEXUS ANALYSIS REPORT</span>
                  <span>{report.reportId}</span>
                </div>
                <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight leading-snug">{report.title}</h1>
                <div className="flex flex-wrap items-center gap-space-md text-[13px] text-on-surface-variant pt-1 font-mono">
                  {report.author && (
                    <>
                      <span>Author: <strong className="text-on-surface">{report.author}</strong></span>
                      <span>•</span>
                    </>
                  )}
                  <span>Generated: {report.generatedAt}</span>
                </div>
              </div>

              {/* Sections (every figure comes from the source job) */}
              {report.sections.map((sec, i) => (
                <div key={sec.id} className="flex flex-col gap-space-sm font-sans">
                  <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                    {i + 1}. {sec.title}
                  </h3>
                  <p className="text-[13px] text-on-surface-variant leading-relaxed">{sec.summary}</p>
                </div>
              ))}

              <div className="p-space-md bg-surface-container-low rounded border border-structural flex flex-col gap-1 font-mono">
                <span className="text-[10px] text-on-surface-variant uppercase font-bold">Digest (SHA-256)</span>
                <span className="text-[11px] text-primary break-all">{report.provenanceHash}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
