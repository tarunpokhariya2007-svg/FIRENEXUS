"""Sensor comparison computed from coincident MODIS/VIIRS pairs."""
from typing import Any, Dict, List, Sequence

import numpy as np

from app.models.schemas import FireObservationSchema, RegressionStats, SensorComparisonResponse
from app.services.matching import match_observations, pearson
from app.services.temporal_analytics import FRP_BIN_EDGES, NO_DATA_MESSAGE

TIME_BIN_MIN = 5.0


def compute_regression(pairs: Sequence[tuple]) -> RegressionStats:
    """OLS of VIIRS FRP on MODIS FRP. Undefined statistics stay None."""
    n = len(pairs)
    if n < 3:
        return RegressionStats(nPairs=n)
    x = np.array([p[0] for p in pairs], dtype=float)
    y = np.array([p[1] for p in pairs], dtype=float)
    r = pearson(x, y)
    if r is None:
        return RegressionStats(nPairs=n)
    slope, intercept = np.polyfit(x, y, 1)
    resid = y - (slope * x + intercept)
    return RegressionStats(
        slope=round(float(slope), 4), intercept=round(float(intercept), 4), rSquared=round(r * r, 4),
        pearsonR=round(r, 4), rmseMw=round(float(np.sqrt(np.mean(resid ** 2))), 4),
        meanBiasMw=round(float(np.mean(y - x)), 4), nPairs=n,
    )


def compute_sensor_comparison(
    observations: Sequence[FireObservationSchema], spatial_tolerance_m: float = 750.0,
    temporal_window_min: float = 30.0,
) -> SensorComparisonResponse:
    modis = [o for o in observations if o.source == "MODIS"]
    viirs = [o for o in observations if o.source == "VIIRS"]
    if not modis or not viirs:
        missing = [name for name, lst in (("MODIS", modis), ("VIIRS", viirs)) if not lst]
        msg = NO_DATA_MESSAGE if len(missing) == 2 else f"{' and '.join(missing)} dataset not loaded. Awaiting NASA dataset."
        return SensorComparisonResponse(status="no_dataset", message=msg)

    result = match_observations(modis, viirs, spatial_tolerance_m, temporal_window_min)
    confirmed = result.confirmed
    frp_pairs = [(p.modis.frp, p.viirs.frp) for p in confirmed if p.modis.frp is not None and p.viirs.frp is not None]

    edges = np.arange(-temporal_window_min, temporal_window_min + TIME_BIN_MIN, TIME_BIN_MIN)
    dts = np.array([p.delta_t_min for p in confirmed]) if confirmed else np.array([])
    time_bins: List[Dict[str, Any]] = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        count = int(np.sum((dts >= lo) & ((dts < hi) | (hi == edges[-1] and dts <= hi)))) if dts.size else 0
        time_bins.append({"range": f"{lo:+.0f} to {hi:+.0f} min", "count": count})

    scatter = [
        {"modisFrp": p.modis.frp, "viirsFrp": p.viirs.frp, "deltaM": round(p.distance_m, 1),
         "confidence": p.modis.confidence}
        for p in confirmed if p.modis.frp is not None and p.viirs.frp is not None
    ]
    hist = []
    for lo, hi in FRP_BIN_EDGES:
        def n_in(lst):
            return sum(1 for o in lst if o.frp is not None and o.frp >= lo and (hi is None or o.frp < hi))
        hist.append({"frpBin": f"{lo}–{hi} MW" if hi is not None else f">{lo} MW",
                     "modisCount": n_in(modis), "viirsCount": n_in(viirs)})

    return SensorComparisonResponse(
        status="ready",
        message=f"Computed from {len(confirmed)} coincident pairs (≤{spatial_tolerance_m:g} m, ≤{temporal_window_min:g} min).",
        timeOffsetBins=time_bins, frpScatterPairs=scatter, frpDistributionHistogram=hist,
        regressionStats=compute_regression(frp_pairs),
    )
