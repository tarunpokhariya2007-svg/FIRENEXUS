from app.services.sensor_comparison import compute_regression, compute_sensor_comparison
from app.services.temporal_analytics import (
    build_calendar_matrix,
    classical_decomposition,
    compute_calendar,
    compute_mann_kendall_test,
    compute_temporal_analytics,
)
from tests.factories import obs


def test_mann_kendall_increasing_decreasing_stable_and_short():
    inc = compute_mann_kendall_test([10, 12, 15, 18, 22, 25, 30, 35])
    assert inc["trend"] == "increasing" and inc["sens_slope"] > 0 and inc["p_value"] < 0.05
    dec = compute_mann_kendall_test([50, 45, 40, 32, 25, 20, 15, 8])
    assert dec["trend"] == "decreasing" and dec["sens_slope"] < 0
    assert compute_mann_kendall_test([20, 20.1, 19.9, 20, 20.2, 19.8, 20, 20.1])["trend"] == "stable"
    assert compute_mann_kendall_test([1, 2])["trend"] == "no trend"


def test_calendar_empty_input_is_no_dataset():
    r = compute_calendar([], 2000, 2020)
    assert r.status == "no_dataset" and r.cells == []


def test_calendar_aggregates_only_what_exists():
    data = [obs("Aqua", 0, 0, date="2020-03-05", frp=1000.0), obs("Terra", 1, 1, date="2020-03-20", frp=3000.0),
            obs("Aqua", 0, 0, date="2021-04-01", frp=None)]
    cells = build_calendar_matrix(data, 2000, 2030)
    assert len(cells) == 2  # no synthetic filler for other months
    mar = [c for c in cells if (c.year, c.month) == (2020, 3)][0]
    assert mar.detectionCount == 2 and mar.frpSumGw == 4.0 and mar.meanFrpMw == 2000.0
    apr = [c for c in cells if (c.year, c.month) == (2021, 4)][0]
    assert apr.meanFrpMw is None and apr.frpSumGw == 0.0


def test_calendar_respects_year_range():
    data = [obs("Aqua", 0, 0, date="2010-01-01"), obs("Aqua", 0, 0, date="2020-01-01")]
    assert [c.year for c in build_calendar_matrix(data, 2015, 2025)] == [2020]


def test_stl_needs_24_contiguous_months():
    short = [(2020, m, float(m)) for m in range(1, 13)]
    assert classical_decomposition(short) == []
    gap = [(2020, m, 1.0) for m in range(1, 13)] + [(2022, m, 1.0) for m in range(1, 13)]
    assert classical_decomposition(gap) == []


def test_stl_components_reconstruct_observed():
    series = [(2019 + (i // 12), i % 12 + 1, 5.0 + i * 0.1 + (3.0 if i % 12 == 7 else 0.0)) for i in range(48)]
    pts = classical_decomposition(series)
    assert len(pts) == 36
    for p in pts:
        assert abs(p.observed - (p.trend + p.seasonal + p.remainder)) < 1e-9


def test_temporal_analytics_empty_and_populated():
    assert compute_temporal_analytics([], 2000, 2020).status == "no_dataset"
    data = [obs("Aqua", 0, 0, date=f"{2015 + i // 12}-{i % 12 + 1:02d}-10", frp=10.0 + i) for i in range(60)]
    res = compute_temporal_analytics(data, 2000, 2030)
    assert res.status == "ready" and res.kpis.sampleSize == 5 and res.kpis.mannKendallTrend == "INCREASING"
    assert len(res.stlDecomposition) == 48 and len(res.monthlySeasonality) == 12
    assert sum(b["modisCount"] for b in res.frpDistribution) == 60


def test_temporal_analytics_range_without_data():
    data = [obs("Aqua", 0, 0, date="2020-01-10")]
    res = compute_temporal_analytics(data, 2000, 2010)
    assert res.status == "ready" and res.stlDecomposition == [] and "No observations" in res.message


def test_regression_undefined_below_three_pairs():
    r = compute_regression([(1.0, 2.0), (2.0, 4.0)])
    assert r.slope is None and r.rSquared is None and r.nPairs == 2


def test_regression_exact_line():
    r = compute_regression([(1.0, 3.0), (2.0, 5.0), (3.0, 7.0), (4.0, 9.0)])
    assert abs(r.slope - 2.0) < 1e-3 and abs(r.intercept - 1.0) < 1e-3 and r.rSquared == 1.0


def test_sensor_comparison_states():
    empty = compute_sensor_comparison([])
    assert empty.status == "no_dataset" and empty.frpScatterPairs == [] and empty.regressionStats.nPairs == 0
    only_modis = compute_sensor_comparison([obs("Aqua", 0, 0)])
    assert only_modis.status == "no_dataset" and "VIIRS" in only_modis.message
    both = compute_sensor_comparison([obs("Aqua", 0, 0, frp=10.0), obs("NOAA-20", 0.001, 0, time="1205", frp=12.0)])
    assert both.status == "ready" and len(both.frpScatterPairs) == 1 and both.regressionStats.nPairs == 1
