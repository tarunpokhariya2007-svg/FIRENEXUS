"""Cross-sensor harmonization service.

Runs the real matching algorithm over whatever the registry holds. If the
required datasets are not loaded the run is refused (it is never simulated).
"""
import time
import uuid
from typing import List, Optional

import numpy as np

from app.models.schemas import (
    HarmonizationInputStatus,
    HarmonizationParametersSchema,
    HarmonizationReadinessResponse,
    HarmonizationResultSchema,
    HarmonizedClusterExcerptSchema,
    FireObservationSchema,
    ALL_PLATFORMS,
    MODIS_PLATFORMS,
)
from app.services.matching import MatchResult, match_observations, observation_time, pearson
from app.services.registry import DatasetRegistry, JobStore

PRODUCTS = {
    "Terra": "MOD14 (MODIS Terra)",
    "Aqua": "MYD14 (MODIS Aqua)",
    "Suomi-NPP": "VNP14IMG (VIIRS S-NPP)",
    "NOAA-20": "VJ114IMG (VIIRS NOAA-20)",
    "NOAA-21": "VJ214IMG (VIIRS NOAA-21)",
}


class DatasetsUnavailable(Exception):
    def __init__(self, missing: List[str]):
        self.missing = missing
        super().__init__("Required datasets are not loaded: " + ", ".join(missing))


class FeatureNotImplemented(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def get_readiness(registry: DatasetRegistry, selected: Optional[List[str]] = None) -> HarmonizationReadinessResponse:
    counts = registry.count_by_platform()
    platforms = selected or list(ALL_PLATFORMS)
    inputs = [
        HarmonizationInputStatus(
            platform=p, product=PRODUCTS[p], available=counts.get(p, 0) > 0, recordCount=counts.get(p, 0)
        )
        for p in ALL_PLATFORMS
    ]
    modis_ok = any(counts.get(p, 0) > 0 for p in platforms if p in MODIS_PLATFORMS)
    viirs_ok = any(counts.get(p, 0) > 0 for p in platforms if p not in MODIS_PLATFORMS)
    missing = []
    if not modis_ok:
        missing.append("MODIS")
    if not viirs_ok:
        missing.append("VIIRS")
    ready = not missing
    reason = (
        "Required MODIS and VIIRS datasets are loaded."
        if ready
        else "Processing disabled: " + " and ".join(missing) + " dataset(s) not loaded. Awaiting NASA dataset."
    )
    return HarmonizationReadinessResponse(ready=ready, reason=reason, inputs=inputs, missing=missing)


def _filter(
    observations: List[FireObservationSchema], params: HarmonizationParametersSchema, min_conf: float
) -> List[FireObservationSchema]:
    out = []
    for o in observations:
        if o.platform not in params.selectedSensors:
            continue
        if not (params.startDate <= o.acq_date <= params.endDate):
            continue
        # FIRMS MODIS confidence is numeric. VIIRS confidence is categorical in
        # its source product; retain its original class and do not threshold it
        # using a numeric MODIS-style parameter.
        if o.source == "MODIS" and o.confidence is not None and o.confidence < min_conf:
            continue
        out.append(o)
    return out


def _fmt_ts(o: FireObservationSchema) -> str:
    t = o.acq_time.zfill(4)
    return f"{o.acq_date} {t[:2]}:{t[2:]} UTC"


def _excerpts(result: MatchResult, limit: int = 10) -> List[HarmonizedClusterExcerptSchema]:
    rows: List[HarmonizedClusterExcerptSchema] = []
    n = 0
    for p in result.pairs:
        n += 1
        rows.append(HarmonizedClusterExcerptSchema(
            clusterId=f"C{n:07d}",
            latitude=round((p.modis.latitude + p.viirs.latitude) / 2.0, 5),
            longitude=round((p.modis.longitude + p.viirs.longitude) / 2.0, 5),
            modisTimestamp=_fmt_ts(p.modis), viirsTimestamp=_fmt_ts(p.viirs),
            deltaSpatialM=round(p.distance_m, 1), deltaTemporalMin=round(abs(p.delta_t_min), 1),
            modisFrp=p.modis.frp, viirsFrp=p.viirs.frp, status=p.status,
        ))
    for v in result.viirs_unmatched:
        n += 1
        rows.append(HarmonizedClusterExcerptSchema(
            clusterId=f"C{n:07d}", latitude=v.latitude, longitude=v.longitude,
            viirsTimestamp=_fmt_ts(v), viirsFrp=v.frp, status="viirs_unmatched",
        ))
    for m in result.modis_unmatched:
        n += 1
        rows.append(HarmonizedClusterExcerptSchema(
            clusterId=f"C{n:07d}", latitude=m.latitude, longitude=m.longitude,
            modisTimestamp=_fmt_ts(m), modisFrp=m.frp, status="modis_unmatched",
        ))
    return rows[:limit]


def execute_harmonization(
    params: HarmonizationParametersSchema, registry: DatasetRegistry, jobs: JobStore
) -> HarmonizationResultSchema:
    if params.enablePsfDeconvolution:
        raise FeatureNotImplemented(
            "PSF_NOT_IMPLEMENTED", "PSF deconvolution is not implemented yet and cannot be enabled."
        )
    readiness = get_readiness(registry, list(params.selectedSensors))
    if not readiness.ready:
        raise DatasetsUnavailable(readiness.missing)

    job_id = f"job-{uuid.uuid4().hex[:8]}"
    started = time.perf_counter()
    logs: List[str] = [
        f"Job {job_id} started.",
        f"Constraints: spatial <= {params.spatialToleranceMeters} m, temporal <= {params.temporalWindowMinutes} min.",
        f"Platforms: {', '.join(params.selectedSensors)}; window {params.startDate} to {params.endDate}.",
    ]
    jobs.save(job_id, HarmonizationResultSchema(jobId=job_id, status="processing", logs=list(logs)), params)
    try:
        modis = _filter(registry.observations("MODIS"), params, params.modisMinConfidence)
        viirs = _filter(registry.observations("VIIRS"), params, params.viirsMinConfidence)
        logs.append(f"Filtered inputs: {len(modis)} MODIS, {len(viirs)} VIIRS records.")
        for o in modis + viirs:
            observation_time(o)  # surfaces malformed acquisition times as a failed job

        result = match_observations(modis, viirs, params.spatialToleranceMeters, params.temporalWindowMinutes)
        confirmed = result.confirmed
        pairs = [(p.modis.frp, p.viirs.frp) for p in confirmed if p.modis.frp is not None and p.viirs.frp is not None]
        r = pearson([a for a, _ in pairs], [b for _, b in pairs])
        total = len(modis) + len(viirs)
        elapsed = round((time.perf_counter() - started) * 1000.0, 1)
        logs.append(
            f"Matching complete: {len(confirmed)} confirmed, {len(result.candidate_duplicates)} candidate duplicates, "
            f"{len(result.viirs_unmatched)} VIIRS unmatched."
        )
        if r is None:
            logs.append("Pearson correlation undefined (needs at least 3 FRP pairs with variance).")
        final = HarmonizationResultSchema(
            jobId=job_id, status="completed", executionTimeMs=elapsed,
            totalRawRecords=total, modisCount=len(modis), viirsCount=len(viirs),
            # Association-based observation estimate: each confirmed pair counts
            # once; all other observations count separately. Alternative edges
            # are reported independently and never merged into this estimate.
            harmonizedUniqueEvents=len(confirmed) + len(result.modis_unmatched) + len(result.viirs_unmatched),
            confirmedCrossMatches=len(confirmed),
            unmatchedViirsObservations=len(result.viirs_unmatched),
            unmatchedModisObservations=len(result.modis_unmatched),
            candidateDuplicates=len(result.candidate_duplicates),
            meanTemporalOffsetMin=round(float(np.mean([abs(p.delta_t_min) for p in confirmed])), 2) if confirmed else None,
            meanSpatialOffsetM=round(float(np.mean([p.distance_m for p in confirmed])), 1) if confirmed else None,
            pearsonR=round(r, 4) if r is not None else None,
            rSquared=round(r * r, 4) if r is not None else None,
            logs=logs, sampleMatches=_excerpts(result),
        )
    except Exception as exc:  # job status must reflect real failures
        final = HarmonizationResultSchema(jobId=job_id, status="failed", logs=logs + [f"Failed: {exc}"], error=str(exc))
    jobs.save(job_id, final, params)
    return final
