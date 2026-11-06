"""Temporal analytics (calendar matrix, STL decomposition, Mann-Kendall).

All functions are pure and operate on the observations passed in. With no
observations they return empty structures.
"""
import math
from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from app.models.schemas import (
    CalendarMonthDataSchema,
    CalendarResponse,
    FireObservationSchema,
    TemporalAnalyticsResponse,
    TemporalDecompositionPointSchema,
    TemporalKpis,
)

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FRP_BIN_EDGES: List[Tuple[float, Optional[float]]] = [
    (0, 10), (10, 25), (25, 50), (50, 100), (100, 250), (250, 500), (500, None)
]
MIN_YEARS_FOR_ANOMALY = 3
NO_DATA_MESSAGE = "No dataset loaded. Awaiting NASA dataset."


def compute_mann_kendall_test(values: Sequence[float]) -> Dict[str, Any]:
    """Mann-Kendall trend test with Sen's slope."""
    n = len(values)
    if n < 3:
        return {"s": 0, "tau": 0.0, "z_score": 0.0, "p_value": 1.0, "sens_slope": 0.0, "trend": "no trend"}
    s = 0
    slopes = []
    for k in range(n - 1):
        for j in range(k + 1, n):
            diff = values[j] - values[k]
            s += (diff > 0) - (diff < 0)
            slopes.append(diff / (j - k))
    var_s = (n * (n - 1) * (2 * n + 5)) / 18.0
    z = (s - 1) / math.sqrt(var_s) if s > 0 else ((s + 1) / math.sqrt(var_s) if s < 0 else 0.0)
    p_value = 2.0 * (1.0 - 0.5 * (1.0 + math.erf(abs(z) / math.sqrt(2.0))))
    trend = "increasing" if z > 1.96 else ("decreasing" if z < -1.96 else "stable")
    return {
        "s": int(s),
        "tau": round(float(s / (0.5 * n * (n - 1))), 3),
        "z_score": round(z, 2),
        "p_value": round(p_value, 4),
        "sens_slope": round(float(np.median(slopes)), 3),
        "trend": trend,
    }


def _metric_value(metric: str, frp_sum_mw: float, count: int) -> float:
    if metric == "count":
        return float(count)
    if metric == "mean_frp":
        return frp_sum_mw / count if count else 0.0
    return frp_sum_mw / 1000.0  # GW


def build_calendar_matrix(
    observations: Sequence[FireObservationSchema], start_year: int, end_year: int, metric: str = "frp_sum"
) -> List[CalendarMonthDataSchema]:
    """Aggregate observations by (year, month). Months without observations are omitted."""
    sums: Dict[Tuple[int, int], float] = defaultdict(float)
    counts: Dict[Tuple[int, int], int] = defaultdict(int)
    frp_counts: Dict[Tuple[int, int], int] = defaultdict(int)
    for o in observations:
        year, month = int(o.acq_date[:4]), int(o.acq_date[5:7])
        if not (start_year <= year <= end_year):
            continue
        counts[(year, month)] += 1
        if o.frp is not None:
            sums[(year, month)] += o.frp
            frp_counts[(year, month)] += 1

    values = {k: _metric_value(metric, sums[k], counts[k] if metric == "count" else frp_counts[k]) for k in counts}
    by_month: Dict[int, List[float]] = defaultdict(list)
    for (_, m), v in values.items():
        by_month[m].append(v)

    cells: List[CalendarMonthDataSchema] = []
    for (year, month) in sorted(counts):
        v = values[(year, month)]
        history = by_month[month]
        is_anomaly, pct = False, None
        if len(history) >= MIN_YEARS_FOR_ANOMALY:
            mean, std = float(np.mean(history)), float(np.std(history))
            if mean > 0:
                pct = int(round((v - mean) / mean * 100.0))
            is_anomaly = std > 0 and (v - mean) / std >= 2.0
        cells.append(CalendarMonthDataSchema(
            year=year, month=month, monthName=MONTH_NAMES[month - 1].upper(),
            frpSumGw=round(sums[(year, month)] / 1000.0, 4), detectionCount=counts[(year, month)],
            meanFrpMw=round(sums[(year, month)] / frp_counts[(year, month)], 2) if frp_counts[(year, month)] else None,
            isAnomaly=is_anomaly, anomalyPercent=pct,
        ))
    return cells


def classical_decomposition(series: Sequence[Tuple[int, int, float]]) -> List[TemporalDecompositionPointSchema]:
    """Classical additive decomposition with a centred 2x12 moving average.

    Requires a gap-free monthly series of at least 24 months. Points near the
    edges (6 months each side) have no trend estimate and are not returned.
    """
    n = len(series)
    if n < 24:
        return []
    for i in range(1, n):
        py, pm, _ = series[i - 1]
        cy, cm, _ = series[i]
        if (py * 12 + pm) + 1 != (cy * 12 + cm):
            return []
    x = [v for _, _, v in series]
    trend: Dict[int, float] = {}
    for i in range(6, n - 6):
        trend[i] = (0.5 * x[i - 6] + sum(x[i - 5:i + 6]) + 0.5 * x[i + 6]) / 12.0
    detr: Dict[int, List[float]] = defaultdict(list)
    for i, t in trend.items():
        detr[series[i][1]].append(x[i] - t)
    if len(detr) < 12:
        return []
    seasonal_raw = {m: float(np.mean(v)) for m, v in detr.items()}
    centre = float(np.mean(list(seasonal_raw.values())))
    seasonal = {m: s - centre for m, s in seasonal_raw.items()}
    out = []
    for i in sorted(trend):
        y, m, obs = series[i]
        s, t = seasonal[m], trend[i]
        out.append(TemporalDecompositionPointSchema(
            date=f"{y}-{m:02d}", year=y, month=m, observed=obs, trend=t, seasonal=s, remainder=obs - t - s
        ))
    return out


def compute_temporal_analytics(
    observations: Sequence[FireObservationSchema], start_year: int, end_year: int, metric: str = "frp_sum"
) -> TemporalAnalyticsResponse:
    if not observations:
        return TemporalAnalyticsResponse(status="no_dataset", message=NO_DATA_MESSAGE)

    cells = build_calendar_matrix(observations, start_year, end_year, metric)
    if not cells:
        return TemporalAnalyticsResponse(
            status="ready", message=f"No observations fall within {start_year}–{end_year}."
        )
    series = [(c.year, c.month, _metric_value(metric, c.frpSumGw * 1000.0, c.detectionCount)) for c in cells]
    if metric == "mean_frp":
        series = [(c.year, c.month, c.meanFrpMw or 0.0) for c in cells]
    stl = classical_decomposition(series)

    by_year: Dict[int, List[float]] = defaultdict(list)
    for y, _, v in series:
        by_year[y].append(v)
    complete_years = sorted(y for y, vals in by_year.items() if len(vals) == 12)
    annual_vals = [float(sum(by_year[y])) if metric != "mean_frp" else float(np.mean(by_year[y])) for y in complete_years]
    kpis = TemporalKpis(sampleSize=len(complete_years))
    annual: List[Dict[str, Any]] = []
    if len(complete_years) >= 3:
        mk = compute_mann_kendall_test(annual_vals)
        kpis = TemporalKpis(
            mannKendallTrend=mk["trend"].upper(), mannKendallTau=mk["tau"], pValue=mk["p_value"],
            sensSlopePerYear=mk["sens_slope"], sampleSize=len(complete_years),
        )
        annual = [{"year": y, "value": round(v, 4), "trendLine": round(annual_vals[0] + i * mk["sens_slope"], 4)}
                  for i, (y, v) in enumerate(zip(complete_years, annual_vals))]
    elif complete_years:
        annual = [{"year": y, "value": round(v, 4), "trendLine": None} for y, v in zip(complete_years, annual_vals)]

    by_month: Dict[int, List[float]] = defaultdict(list)
    for _, m, v in series:
        by_month[m].append(v)
    seasonal_by_month = {p.month: p.seasonal for p in stl}
    seasonality = [
        {"month": MONTH_NAMES[m - 1], "meanValue": round(float(np.mean(by_month[m])), 4),
         "stdValue": round(float(np.std(by_month[m])), 4), "years": len(by_month[m]),
         "seasonalAmplitude": round(seasonal_by_month[m], 4) if m in seasonal_by_month else None}
        for m in range(1, 13) if m in by_month
    ]

    frp = [o for o in observations if o.frp is not None and start_year <= int(o.acq_date[:4]) <= end_year]
    dist = []
    for lo, hi in FRP_BIN_EDGES:
        in_bin = [o for o in frp if o.frp >= lo and (hi is None or o.frp < hi)]
        dist.append({
            "frpBin": f"{lo}–{hi} MW" if hi is not None else f">{lo} MW",
            "modisCount": sum(1 for o in in_bin if o.source == "MODIS"),
            "viirsCount": sum(1 for o in in_bin if o.source == "VIIRS"),
        })

    message = "Analysis computed from loaded observations."
    if not stl:
        message += " STL decomposition needs a gap-free monthly series of at least 24 months."
    return TemporalAnalyticsResponse(
        status="ready", message=message, kpis=kpis, stlDecomposition=stl,
        annualTrends=annual, monthlySeasonality=seasonality, frpDistribution=dist,
    )


def compute_calendar(
    observations: Sequence[FireObservationSchema], start_year: int, end_year: int, metric: str = "frp_sum"
) -> CalendarResponse:
    if not observations:
        return CalendarResponse(status="no_dataset", message=NO_DATA_MESSAGE, startYear=start_year,
                                endYear=end_year, metric=metric)
    cells = build_calendar_matrix(observations, start_year, end_year, metric)
    message = "Calendar computed from loaded observations." if cells else f"No observations fall within {start_year}–{end_year}."
    return CalendarResponse(status="ready", message=message, startYear=start_year, endYear=end_year,
                            metric=metric, cells=cells)
