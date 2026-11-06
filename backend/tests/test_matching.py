from app.services.geodesy import compute_haversine_distance_meters
from app.services.matching import match_observations, pearson
from tests.factories import obs


def test_haversine_zero_and_known_distance():
    assert compute_haversine_distance_meters(1.0, 2.0, 1.0, 2.0) == 0.0
    assert 111000 <= compute_haversine_distance_meters(0.0, 0.0, 1.0, 0.0) <= 111500


def test_empty_inputs_return_empty_results():
    r = match_observations([], [], 750, 30)
    assert r.pairs == [] and r.viirs_unmatched == [] and r.modis_unmatched == []


def test_viirs_unmatched_when_no_modis():
    v = [obs("NOAA-20", 0.0, 0.0)]
    r = match_observations([], v, 750, 30)
    assert r.viirs_unmatched == v and r.pairs == []


def test_confirmed_match_within_tolerances():
    m = obs("Aqua", 0.0, 0.0, time="1200")
    v = obs("NOAA-20", 0.001, 0.0, time="1210")  # ~111 m, +10 min
    r = match_observations([m], [v], 750, 30)
    assert len(r.confirmed) == 1
    assert r.confirmed[0].distance_m < 750
    assert round(r.confirmed[0].delta_t_min) == 10


def test_outside_temporal_window_is_unmatched_not_candidate_duplicate():
    m = obs("Aqua", 0.0, 0.0, time="1200")
    v = obs("NOAA-20", 0.001, 0.0, time="1300")
    r = match_observations([m], [v], 750, 30)
    assert len(r.confirmed) == 0 and len(r.candidate_duplicates) == 0
    assert r.viirs_unmatched == [v] and r.modis_unmatched == [m]


def test_no_match_beyond_spatial_tolerance():
    m = obs("Aqua", 0.0, 0.0)
    v = obs("NOAA-20", 0.1, 0.0)
    r = match_observations([m], [v], 750, 30)
    assert r.viirs_unmatched == [v] and r.modis_unmatched == [m]


def test_date_difference_is_respected():
    m = obs("Aqua", 0.0, 0.0, date="2020-01-01", time="1200")
    v = obs("NOAA-20", 0.0, 0.0, date="2020-01-02", time="1200")
    r = match_observations([m], [v], 750, 30)
    assert len(r.confirmed) == 0 and len(r.candidate_duplicates) == 0
    assert r.viirs_unmatched == [v] and r.modis_unmatched == [m]


def test_one_to_one_policy_prevents_modis_reuse_and_keeps_alternative_edges():
    m = obs("Aqua", 0.0, 0.0)
    v1 = obs("NOAA-20", 0.0001, 0.0, time="1201")
    v2 = obs("NOAA-21", 0.0002, 0.0, time="1202")
    r = match_observations([m], [v1, v2], 750, 30)
    assert len(r.confirmed) == 1
    assert len(r.candidate_duplicates) == 1
    assert len({p.modis.id for p in r.confirmed}) == len(r.confirmed)
    assert len(r.viirs_unmatched) == 1


def test_all_spatiotemporal_candidates_are_retained_for_assignment():
    m1 = obs("Aqua", 0.0, 0.0, time="1200")
    m2 = obs("Terra", 0.004, 0.0, time="1210")
    v1 = obs("NOAA-20", 0.001, 0.0, time="1204")
    v2 = obs("NOAA-21", 0.003, 0.0, time="1206")
    r = match_observations([m1, m2], [v1, v2], 750, 30)
    assert len(r.pairs) == 4
    assert len(r.confirmed) == 2
    assert len(r.candidate_duplicates) == 2


def test_temporal_and_spatial_limits_are_both_required():
    m = obs("Aqua", 0.0, 0.0, time="1200")
    too_late = obs("NOAA-20", 0.001, 0.0, time="1231")
    too_far = obs("NOAA-21", 0.02, 0.0, time="1201")
    r = match_observations([m], [too_late, too_far], 750, 30)
    assert not r.pairs
    assert r.viirs_unmatched == [too_late, too_far]
    assert r.modis_unmatched == [m]


def test_sparse_assignment_maximizes_cardinality_before_nearest_local_choice():
    m1 = obs("Aqua", 0.0, 0.0)
    m2 = obs("Terra", 0.0, 0.01)
    v1 = obs("NOAA-20", 0.0, 0.0055)
    v2 = obs("NOAA-21", 0.0, 0.0)
    r = match_observations([m1, m2], [v1, v2], 750, 30)
    assert len(r.confirmed) == 2
    pairs = {(p.viirs.platform, p.modis.platform) for p in r.confirmed}
    assert pairs == {("NOAA-20", "Terra"), ("NOAA-21", "Aqua")}
    assert len(r.candidate_duplicates) == 1


def test_temporal_offset_breaks_equal_distance_assignment_ties():
    m1 = obs("Aqua", 0.0, 0.0, time="1200")
    m2 = obs("Terra", 0.0, 0.0, time="1201")
    v1 = obs("NOAA-20", 0.0, 0.0, time="1200")
    v2 = obs("NOAA-21", 0.0, 0.0, time="1201")
    r = match_observations([m1, m2], [v1, v2], 750, 30)
    assert {(p.viirs.platform, p.modis.platform) for p in r.confirmed} == {
        ("NOAA-20", "Aqua"), ("NOAA-21", "Terra")
    }


def test_large_dense_candidate_graph_uses_sparse_assignment():
    # Generated algorithmic fixtures only; these are not observations or results.
    modis = [obs("Aqua" if i % 2 == 0 else "Terra", 0.0, i * 1e-7, oid=f"m{i}") for i in range(160)]
    viirs = [obs("NOAA-20" if i % 2 == 0 else "NOAA-21", i * 1e-7, 0.0, oid=f"v{i}") for i in range(160)]
    r = match_observations(modis, viirs, 750, 30)
    assert len(r.confirmed) == 160
    assert len(r.candidate_duplicates) == 160 * 160 - 160


def test_pearson_undefined_cases():
    assert pearson([1, 2], [1, 2]) is None
    assert pearson([1, 1, 1], [1, 2, 3]) is None
    assert abs(pearson([1, 2, 3], [2, 4, 6]) - 1.0) < 1e-9
