"""Report generation from completed analyses only.

A report can only be produced from a completed harmonization job. Every figure
in the text is read from that job; there is no template prose containing
results, no DOI and no author unless the requester supplies one.
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import List, Optional

from app.models.schemas import (
    ReportAvailabilityResponse,
    ReportSectionSchema,
    ScientificReportSchema,
)
from app.services.registry import JobStore

SECTION_IDS = ["harmonization-summary", "cross-sensor-agreement", "provenance"]
NO_ANALYSIS = "No valid analysis exists. Load NASA datasets and run harmonization first."


class NoValidAnalysis(Exception):
    pass


def get_report_availability(jobs: JobStore) -> ReportAvailabilityResponse:
    if jobs.latest_completed() is None:
        return ReportAvailabilityResponse(status="no_dataset", canGenerate=False, reason=NO_ANALYSIS,
                                          message=NO_ANALYSIS)
    return ReportAvailabilityResponse(status="ready", canGenerate=True, reason="A completed analysis is available.",
                                      message="Report can be generated from the latest completed harmonization job.",
                                      availableSections=list(SECTION_IDS))


def _fmt(v, suffix: str = "") -> str:
    return "not defined" if v is None else f"{v:,}{suffix}" if isinstance(v, int) else f"{v}{suffix}"


def generate_scientific_report(
    jobs: JobStore, title: Optional[str] = None, author: Optional[str] = None,
    include_sections: Optional[List[str]] = None,
) -> ScientificReportSchema:
    entry = jobs.latest_completed()
    if entry is None:
        raise NoValidAnalysis(NO_ANALYSIS)
    r, params = entry["result"], entry["params"]
    wanted = [s for s in (include_sections or SECTION_IDS) if s in SECTION_IDS] or list(SECTION_IDS)

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    digest = hashlib.sha256(json.dumps(
        {"job": r.jobId, "params": params.model_dump(), "result": r.model_dump(exclude={"logs", "executionTimeMs"})},
        sort_keys=True, default=str).encode("utf-8")).hexdigest()

    texts = {
        "harmonization-summary": ("Harmonization summary",
            f"{_fmt(r.totalRawRecords)} input records ({_fmt(r.modisCount)} MODIS, {_fmt(r.viirsCount)} VIIRS) "
            f"for {params.startDate} to {params.endDate}; {_fmt(r.confirmedCrossMatches)} confirmed cross-matches, "
            f"{_fmt(r.candidateDuplicates)} candidate duplicate associations, {_fmt(r.unmatchedViirsObservations)} unmatched VIIRS observations, "
            f"and {_fmt(r.unmatchedModisObservations)} unmatched MODIS observations."),
        "cross-sensor-agreement": ("Cross-sensor FRP agreement",
            f"Pearson r = {_fmt(r.pearsonR)}, R² = {_fmt(r.rSquared)}; mean offset "
            f"{_fmt(r.meanSpatialOffsetM, ' m')} / {_fmt(r.meanTemporalOffsetMin, ' min')} "
            f"(constraints {params.spatialToleranceMeters:g} m / {params.temporalWindowMinutes:g} min)."),
        "provenance": ("Provenance",
            f"Generated from harmonization job {r.jobId}. Digest is a SHA-256 over the job parameters and results."),
    }
    sections = [ReportSectionSchema(id=sid, title=texts[sid][0], summary=texts[sid][1]) for sid in wanted]
    return ScientificReportSchema(
        title=title or f"Harmonization report {r.jobId}", reportId=f"RPT-{r.jobId}", generatedAt=generated_at,
        author=author or None, sections=sections, provenanceHash=digest, sourceJobId=r.jobId,
    )
