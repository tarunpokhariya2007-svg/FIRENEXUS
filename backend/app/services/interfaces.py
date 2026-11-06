"""Service boundaries for the future NASA data pipeline.

These Protocols define what each stage consumes and produces. Concrete NASA
implementations will be added in the next development phase; the API layer and
the frontend only depend on these contracts, so swapping in real data does not
require rewriting them.
"""
from typing import List, Optional, Protocol, Sequence

from app.models.schemas import (
    DatasetMetadataSchema,
    FireObservationSchema,
    HarmonizationParametersSchema,
    HarmonizationResultSchema,
    ScientificReportSchema,
    SchemaValidationResponse,
)


class ObservationIngestor(Protocol):
    """Parses a MODIS or VIIRS product into validated observations."""

    sensor: str

    def ingest(self, source_path: str) -> "IngestionOutput": ...


class IngestionOutput(Protocol):
    metadata: DatasetMetadataSchema
    observations: Sequence[FireObservationSchema]


class DatasetValidator(Protocol):
    def validate_columns(self, sensor: str, columns: Sequence[str]) -> SchemaValidationResponse: ...


class SpatialTemporalMatcher(Protocol):
    def match(
        self,
        modis: Sequence[FireObservationSchema],
        viirs: Sequence[FireObservationSchema],
        spatial_tolerance_m: float,
        temporal_window_min: float,
    ) -> "object": ...


class Harmonizer(Protocol):
    def run(self, params: HarmonizationParametersSchema) -> HarmonizationResultSchema: ...


class TemporalAnalyzer(Protocol):
    def analyze(self, observations: Sequence[FireObservationSchema], start_year: int, end_year: int) -> "object": ...


class SensorComparator(Protocol):
    def compare(self, observations: Sequence[FireObservationSchema]) -> "object": ...


class ReportGenerator(Protocol):
    def generate(self, job_id: str, title: Optional[str], author: Optional[str], sections: List[str]) -> ScientificReportSchema: ...
