"""Dataset schema validation against the documented NASA FIRMS CSV layouts."""
from collections import Counter
from typing import Dict, List, Sequence

from app.models.schemas import SchemaValidationResponse

# Column layouts of the public NASA FIRMS active-fire CSV products.
REQUIRED_COLUMNS: Dict[str, List[str]] = {
    "MODIS": ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time",
              "satellite", "confidence", "version", "bright_t31", "frp", "daynight"],
    "VIIRS": ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time",
              "satellite", "confidence", "version", "bright_ti5", "frp", "daynight"],
}
OPTIONAL_COLUMNS: Dict[str, List[str]] = {"MODIS": ["instrument", "type"], "VIIRS": ["instrument", "type"]}


def validate_columns(sensor: str, columns: Sequence[str]) -> SchemaValidationResponse:
    if sensor not in REQUIRED_COLUMNS:
        raise ValueError(f"Unsupported sensor: {sensor}")
    cleaned = [c.strip().lower() for c in columns]
    counts = Counter(cleaned)
    duplicates = sorted(c for c, n in counts.items() if n > 1)
    required = REQUIRED_COLUMNS[sensor]
    known = set(required) | set(OPTIONAL_COLUMNS[sensor])
    missing = [c for c in required if c not in counts]
    unexpected = sorted(c for c in counts if c not in known)
    valid = not missing and not duplicates
    if valid:
        message = f"Header matches the {sensor} FIRMS layout."
        if unexpected:
            message += f" {len(unexpected)} additional column(s) will be ignored."
    else:
        parts = []
        if missing:
            parts.append(f"missing required: {', '.join(missing)}")
        if duplicates:
            parts.append(f"duplicate columns: {', '.join(duplicates)}")
        message = f"Header does not match the {sensor} FIRMS layout ({'; '.join(parts)})."
    return SchemaValidationResponse(
        sensor=sensor,
        valid=valid,
        expectedColumns=required,
        missingRequired=missing,
        unexpectedColumns=unexpected,
        duplicateColumns=duplicates,
        message=message,
    )
