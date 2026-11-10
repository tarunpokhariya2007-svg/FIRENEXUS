from app.main import get_hotspots, get_regions, put_region
import app.main as main_module
from app.models.schemas import DatasetMetadataSchema, RegionDefinitionSchema
from app.services.registry import DatasetRegistry
from app.services.regions import RegionStore
from tests.factories import obs


def test_four_demonstration_regions_have_approximate_boxes_and_empty_data_by_default():
    regions = RegionStore().list()
    assert {r.name for r in regions} == {
        "Amazon Basin, Brazil", "California, USA", "Southeastern Australia", "Uttarakhand, India"
    }
    assert all(r.boundingBox.minLatitude <= r.boundingBox.maxLatitude for r in regions)
    assert all("Approximate" in r.boundaryNote for r in regions)
    response_rows = get_regions(DatasetRegistry())
    assert all(r.datasetIds == [] and r.dateCoverageStart is None for r in response_rows)


def test_region_persists_and_associates_datasets_by_bbox_and_date_coverage(tmp_path, monkeypatch):
    store = RegionStore(str(tmp_path))
    definition = RegionDefinitionSchema(
        id="test-region", name="Test Region", country="Test Country",
        boundingBox={"minLatitude": -1, "maxLatitude": 1, "minLongitude": -1, "maxLongitude": 1},
        boundaryNote="Test-only algorithm fixture.",
    )
    monkeypatch.setattr(main_module, "region_store", store)
    put_region("test-region", definition, DatasetRegistry())
    reg = DatasetRegistry()
    reg.register(DatasetMetadataSchema(id="modis-a", title="A", sensor="MODIS"), [
        obs("Aqua", 0.2, 0.3, date="2020-01-02", oid="inside-1"),
        obs("Aqua", 0.4, 0.4, date="2020-02-03", oid="inside-2"),
        obs("Terra", 12, 12, date="2020-01-01", oid="outside"),
    ])
    reg.register(DatasetMetadataSchema(id="modis-b", title="B", sensor="MODIS"), [
        obs("Aqua", 0.1, 0.1, date="2021-01-01", oid="other-dataset"),
    ])
    region = next(r for r in get_regions(reg) if r.id == "test-region")
    assert region.datasetIds == ["modis-a", "modis-b"]
    assert (region.dateCoverageStart, region.dateCoverageEnd) == ("2020-01-02", "2021-01-01")

    result = get_hotspots(
        sensor="MODIS", min_confidence=0, min_frp=0, max_frp=None,
        start_date=None, end_date=None, min_lat=-90, max_lat=90,
        min_lon=-180, max_lon=180, limit=50, platform="Aqua",
        region_id="test-region", reg=reg,
    )
    assert result.total == 3
    assert {o.platform for o in result.items} == {"Aqua"}
    assert {o.id for o in result.items} == {"inside-1", "inside-2", "other-dataset"}
    assert RegionStore(str(tmp_path)).get("test-region") == definition
