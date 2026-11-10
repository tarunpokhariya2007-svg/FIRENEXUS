"""Spatial-temporal matching of MODIS and VIIRS observations.

Pure algorithm: it only works on the observations it is handed. With empty
inputs it returns empty results; it never synthesises matches.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional, Sequence

import numpy as np
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import min_weight_full_bipartite_matching

from app.models.schemas import FireObservationSchema
from app.services.geodesy import EARTH_RADIUS_M, compute_haversine_distance_meters


@dataclass
class MatchPair:
    modis: FireObservationSchema
    viirs: FireObservationSchema
    distance_m: float
    delta_t_min: float  # signed: VIIRS minus MODIS
    status: str  # 'harmonized_match' | 'candidate_duplicate'


@dataclass
class MatchResult:
    pairs: List[MatchPair] = field(default_factory=list)
    viirs_unmatched: List[FireObservationSchema] = field(default_factory=list)
    modis_unmatched: List[FireObservationSchema] = field(default_factory=list)

    @property
    def confirmed(self) -> List[MatchPair]:
        return [p for p in self.pairs if p.status == "harmonized_match"]

    @property
    def candidate_duplicates(self) -> List[MatchPair]:
        return [p for p in self.pairs if p.status == "candidate_duplicate"]


def observation_time(obs: FireObservationSchema) -> datetime:
    """Parse acq_date (YYYY-MM-DD) and acq_time (HHMM, UTC) into an aware datetime."""
    hhmm = obs.acq_time.zfill(4)
    return datetime.strptime(f"{obs.acq_date} {hhmm}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)


def _to_unit_xyz(lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))


def match_observations(
    modis: Sequence[FireObservationSchema],
    viirs: Sequence[FireObservationSchema],
    spatial_tolerance_m: float,
    temporal_window_min: float,
) -> MatchResult:
    """Build all valid edges, then select a one-to-one association.

    Policy: maximize the number of associations satisfying *both* the great-circle
    spatial tolerance and absolute time window; among maximum-cardinality solutions,
    minimize distance, then time offset. Other valid edges are retained as
    ``candidate_duplicate`` pairs for review, but do not count as associations.
    Observations with no selected edge remain sensor-unmatched. This is an
    observation association policy, not a claim about unique physical fires.
    """
    result = MatchResult()
    if not viirs:
        result.modis_unmatched = list(modis)
        return result
    if not modis:
        result.viirs_unmatched = list(viirs)
        return result

    m_lat = np.array([m.latitude for m in modis])
    m_lon = np.array([m.longitude for m in modis])
    tree = cKDTree(_to_unit_xyz(m_lat, m_lon))
    chord = 2.0 * np.sin(min(spatial_tolerance_m / EARTH_RADIUS_M, np.pi) / 2.0)
    m_times = [observation_time(m) for m in modis]
    valid_edges = []

    v_xyz = _to_unit_xyz(np.array([v.latitude for v in viirs]), np.array([v.longitude for v in viirs]))
    candidate_lists = tree.query_ball_point(v_xyz, r=chord)

    for vi, (v, idxs) in enumerate(zip(viirs, candidate_lists)):
        v_time = observation_time(v)
        scored = []
        for i in idxs:
            dist = compute_haversine_distance_meters(v.latitude, v.longitude, modis[i].latitude, modis[i].longitude)
            if dist > spatial_tolerance_m:
                continue
            dt = (v_time - m_times[i]).total_seconds() / 60.0
            if abs(dt) <= temporal_window_min:
                scored.append((i, dist, dt))
        if not scored:
            continue
        for edge in scored:
            valid_edges.append((vi, *edge))

    if valid_edges:
        # A sparse full row assignment gives each VIIRS observation either one
        # candidate MODIS column or its own dummy unmatched column. A penalty
        # larger than the greatest possible total edge cost makes cardinality
        # the primary objective; distance is primary cost and time is a small
        # secondary term. Storage is O(V + M + E), where E is the candidate set.
        n_v, n_m = len(viirs), len(modis)
        unmatched_penalty = (min(n_v, n_m) + 1) * (spatial_tolerance_m + 1.0) + 1.0
        edge_map = {}
        row_indices, col_indices, weights = [], [], []
        for vi, mi, dist, dt in valid_edges:
            row_indices.append(vi)
            col_indices.append(mi)
            weights.append(dist + abs(dt) * 1e-6 + 1e-9)
            edge_map[(vi, mi)] = (dist, dt)
        for vi in range(n_v):
            row_indices.append(vi)
            col_indices.append(n_m + vi)
            weights.append(unmatched_penalty)
        graph = coo_matrix((weights, (row_indices, col_indices)), shape=(n_v, n_m + n_v)).tocsr()
        rows, cols = min_weight_full_bipartite_matching(graph)
        selected = {(int(vi), int(mi)) for vi, mi in zip(rows, cols) if mi < n_m and (vi, mi) in edge_map}
        for vi, mi, dist, dt in ((vi, mi, *edge_map[(vi, mi)]) for vi, mi in sorted(edge_map)):
            status = "harmonized_match" if (vi, mi) in selected else "candidate_duplicate"
            result.pairs.append(MatchPair(modis=modis[mi], viirs=viirs[vi], distance_m=dist, delta_t_min=dt, status=status))
        used_v = {vi for vi, _ in selected}
        used_m = {mi for _, mi in selected}
    else:
        used_v, used_m = set(), set()
    result.viirs_unmatched = [v for i, v in enumerate(viirs) if i not in used_v]
    result.modis_unmatched = [m for i, m in enumerate(modis) if i not in used_m]
    return result


def pearson(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    """Pearson r, or None when it is undefined (fewer than 3 pairs or zero variance)."""
    if len(xs) < 3 or len(xs) != len(ys):
        return None
    x, y = np.asarray(xs, dtype=float), np.asarray(ys, dtype=float)
    if np.std(x) == 0.0 or np.std(y) == 0.0:
        return None
    return float(np.corrcoef(x, y)[0, 1])
