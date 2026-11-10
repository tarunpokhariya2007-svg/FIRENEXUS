"""Import a local NASA FIRMS CSV without contacting NASA or creating jobs."""
import argparse
from datetime import date
import json
import sys

from app.config import settings
from app.services.existing_csv_import import ExistingCsvImporter, ExistingCsvImportError, ImportProvenance


def _iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Use an ISO date in YYYY-MM-DD form.") from None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Import an existing FIRMS CSV; this command never downloads from NASA.")
    parser.add_argument("--file", required=True, help="Path to the already-downloaded source CSV.")
    parser.add_argument("--region-id", choices=("amazon_basin",), required=True)
    parser.add_argument("--source-id", choices=("MODIS_SP", "VIIRS_SNPP_SP"), required=True)
    parser.add_argument("--start-date", type=_iso_date, required=True)
    parser.add_argument("--end-date", type=_iso_date, required=True)
    parser.add_argument("--processing-level", choices=("SP",), default="SP")
    parser.add_argument("--expected-observations", type=int, required=True,
                        help="Validation target; parsed records are never forced to this value.")
    args = parser.parse_args(argv)
    if not settings.DATABASE_URL:
        print("DATABASE_URL is not configured in the backend environment.", file=sys.stderr)
        return 2

    # Import only after the caller has explicitly invoked this local-file command.
    from app.services.registry import DatasetRegistry

    try:
        registry = DatasetRegistry(settings.DATA_DIR, settings.DATABASE_URL, settings.DATABASE_SSL_CA)
        importer = ExistingCsvImporter(registry, settings.DATA_DIR, settings.MAX_UPLOAD_BYTES,
                                       settings.DATABASE_URL, settings.DATABASE_SSL_CA)
        result = importer.import_file(
            args.file,
            ImportProvenance(args.region_id, args.source_id, args.start_date, args.end_date,
                             processing_level=args.processing_level),
            expected_observations=args.expected_observations,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except ExistingCsvImportError as exc:
        print(json.dumps({"error": {"code": exc.code, "message": str(exc), "report": exc.report}}, indent=2), file=sys.stderr)
        return 1
    except Exception as exc:
        print(json.dumps({"error": {"code": "IMPORT_SETUP_FAILED", "message": "Import setup failed; inspect backend configuration without sharing credentials."}}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
