"""Offline validation tests for the local existing-CSV import path."""
import csv
import importlib
import io
from datetime import date

import pytest

from app.services.existing_csv_import import (
    ExistingCsvImportError,
    ExistingCsvImporter,
    ImportProvenance,
    SOURCE_PRODUCTS,
    sha256_file,
)

MODIS = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time",
         "satellite", "confidence", "version", "bright_t31", "frp", "daynight"]
VIIRS = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time",
         "satellite", "confidence", "version", "bright_ti5", "frp", "daynight"]


def csv_bytes(columns, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(columns)
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def record(columns, **overrides):
    values = {"latitude": "-3.25", "longitude": "-60.5", "brightness": "320.1",
              "bright_ti4": "310.2", "scan": "1.0", "track": "1.1", "acq_date": "2024-02-03",
              "acq_time": "45", "satellite": "Terra", "confidence": "85", "version": "6.1N",
              "bright_t31": "290.0", "bright_ti5": "280.0", "frp": "12.5", "daynight": "D"}
    values.update(overrides)
    return [values.get(column, "") for column in columns]


def importer(tmp_path):
    # The URL is only checked for presence in __init__; tests below never open it.
    return ExistingCsvImporter(object(), tmp_path / "store", 2_000_000,
                               "postgresql://not-used", "")


@pytest.mark.parametrize(("source_id", "columns", "satellite", "confidence", "sensor", "platform", "confidence_class"), [
    ("MODIS_SP", MODIS, "Aqua", "87", "MODIS", "Aqua", None),
    ("VIIRS_SNPP_SP", VIIRS, "Suomi-NPP", "n", "VIIRS", "Suomi-NPP", "n"),
])
def test_prepares_valid_modis_and_viirs_with_structured_provenance(
        tmp_path, source_id, columns, satellite, confidence, sensor, platform, confidence_class):
    source = tmp_path / f"{source_id}.csv"
    original = csv_bytes(columns, [record(columns, satellite=satellite, confidence=confidence)])
    source.write_bytes(original)
    service = importer(tmp_path)
    provenance = ImportProvenance("amazon_basin", source_id, date(2024, 2, 1), date(2024, 2, 28))
    product_sensor = provenance.validate()
    values = provenance.as_dict(product_sensor, source.name, str(source.resolve()), sha256_file(source))

    prepared = service._prepare(source, values["sourceSha256"], values, product_sensor,
                                provenance, expected=1)
    try:
        assert prepared.metadata.sensor == sensor
        assert prepared.metadata.provenance == values
        assert prepared.metadata.recordCount == 1
        assert prepared.report["minimumAcquisitionDate"] == "2024-02-03"
        assert source.read_bytes() == original
        with prepared.observations_path.open(encoding="utf-8") as stream:
            observation = __import__("app.models.schemas", fromlist=["FireObservationSchema"]).FireObservationSchema.model_validate_json(stream.readline())
        assert (observation.source, observation.platform, observation.confidence_class) == (sensor, platform, confidence_class)
        assert observation.longitude == -60.5 and observation.latitude == -3.25
        assert observation.source_columns["confidence"] == confidence
        assert SOURCE_PRODUCTS[source_id]["sensor"] == sensor
    finally:
        service._discard_artifacts(prepared)


def test_duplicate_source_rows_are_reported_and_retained(tmp_path):
    source = tmp_path / "duplicates.csv"
    duplicate = record(MODIS)
    source.write_bytes(csv_bytes(MODIS, [duplicate, duplicate]))
    service = importer(tmp_path)
    provenance = ImportProvenance("amazon_basin", "MODIS_SP", date(2024, 2, 1), date(2024, 2, 28))
    values = provenance.as_dict("MODIS", source.name, str(source.resolve()), sha256_file(source))
    prepared = service._prepare(source, values["sourceSha256"], values, "MODIS", provenance, expected=2)
    try:
        assert prepared.metadata.recordCount == 2
        assert prepared.report["duplicateRecords"] == 1
        assert prepared.metadata.qualityReport["existingCsvImport"]["duplicatePolicy"].startswith("Retained")
    finally:
        service._discard_artifacts(prepared)


@pytest.mark.parametrize(("overrides", "expected_code"), [
    ({"latitude": "91"}, "REJECTED_ROWS"),
    ({"satellite": "NOAA-20"}, "REJECTED_ROWS"),
    ({"acq_date": "2024-03-01"}, "DATE_COVERAGE_MISMATCH"),
])
def test_invalid_coordinates_platform_and_date_never_prepare_an_import(tmp_path, overrides, expected_code):
    source = tmp_path / "invalid.csv"
    source.write_bytes(csv_bytes(MODIS, [record(MODIS, **overrides)]))
    service = importer(tmp_path)
    provenance = ImportProvenance("amazon_basin", "MODIS_SP", date(2024, 2, 1), date(2024, 2, 28))
    values = provenance.as_dict("MODIS", source.name, str(source.resolve()), sha256_file(source))
    with pytest.raises(ExistingCsvImportError) as error:
        service._prepare(source, values["sourceSha256"], values, "MODIS", provenance, expected=1)
    assert error.value.code == expected_code
    assert not list((tmp_path / "store").glob("fir-*/metadata.json"))
    assert source.exists()


def test_invalid_schema_and_conflicting_source_metadata_are_rejected(tmp_path):
    source = tmp_path / "wrong-schema.csv"
    source.write_bytes(csv_bytes(MODIS[:-1], []))
    service = importer(tmp_path)
    provenance = ImportProvenance("amazon_basin", "MODIS_SP", date(2024, 2, 1), date(2024, 2, 28))
    values = provenance.as_dict("MODIS", source.name, str(source.resolve()), sha256_file(source))
    with pytest.raises(ExistingCsvImportError) as error:
        service._prepare(source, values["sourceSha256"], values, "MODIS", provenance, expected=0)
    assert error.value.code == "INVALID_SCHEMA"

    with pytest.raises(ExistingCsvImportError) as error:
        ImportProvenance("california", "MODIS_SP", date(2024, 2, 1), date(2024, 2, 28)).validate()
    assert error.value.code == "INVALID_REGION"


def test_expected_count_is_a_validation_target_not_a_forced_count(tmp_path):
    source = tmp_path / "one.csv"
    source.write_bytes(csv_bytes(MODIS, [record(MODIS)]))
    service = importer(tmp_path)
    provenance = ImportProvenance("amazon_basin", "MODIS_SP", date(2024, 2, 1), date(2024, 2, 28))
    values = provenance.as_dict("MODIS", source.name, str(source.resolve()), sha256_file(source))
    with pytest.raises(ExistingCsvImportError, match="expected-count") as error:
        service._prepare(source, values["sourceSha256"], values, "MODIS", provenance, expected=11_907)
    assert error.value.code == "EXPECTED_COUNT_MISMATCH"


def test_existing_csv_module_has_no_nasa_or_network_client_dependency():
    module = importlib.import_module("app.services.existing_csv_import")
    assert "AcquisitionManager" not in module.__dict__
    assert "httpx" not in module.__dict__
    assert "requests" not in module.__dict__
