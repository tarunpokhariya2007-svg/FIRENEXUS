"""Read-only PostgreSQL/PostGIS verification CLI; never runs migrations."""
import json
import sys

from app.config import settings
from app.services.database import DatabaseVerificationError, verify_readonly_connection


def main() -> int:
    if not settings.DATABASE_URL:
        print("DATABASE_URL is not configured in the backend environment.", file=sys.stderr)
        return 2
    try:
        result = verify_readonly_connection(settings.DATABASE_URL, settings.DATABASE_SSL_CA)
    except DatabaseVerificationError as exc:
        print(f"Database verification failure category: {exc.category}", file=sys.stderr)
        print(exc.safe_message, file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
