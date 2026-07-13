"""Write (or clear) the current Operator tunnel URL into Supabase.

Called from the GitHub Actions workflow after cloudflared prints the public
URL. The phone launcher page reads this row to know where to connect.

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  - required
  OPERATOR_PUBLIC_URL                       - the trycloudflare.com URL, or empty to clear
  OPERATOR_RUN_ID                           - GitHub Actions run id (informational)
  OPERATOR_DURATION_MINUTES                 - how long we intend to stay up
"""
from __future__ import annotations
import os
import sys
from datetime import datetime, timedelta, timezone

from supabase import create_client


def main() -> int:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 1

    public_url = os.environ.get("OPERATOR_PUBLIC_URL", "").strip() or None
    run_id = os.environ.get("OPERATOR_RUN_ID") or None
    minutes = int(os.environ.get("OPERATOR_DURATION_MINUTES") or "350")

    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(minutes=minutes)).isoformat() if public_url else None

    sb = create_client(url, key)
    sb.table("op_session_endpoint").upsert(
        {
            "id": 1,
            "url": public_url,
            "started_at": now.isoformat() if public_url else None,
            "expires_at": expires_at,
            "run_id": run_id,
        },
        on_conflict="id",
    ).execute()

    print(f"Published endpoint: url={public_url!r} expires_at={expires_at}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
