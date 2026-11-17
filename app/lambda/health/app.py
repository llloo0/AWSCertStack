"""GET /api/health — 不需要鉴权。"""

from __future__ import annotations

from datetime import datetime, timezone

from certstack.http import json_response, run


def handler(event, context):
    return run(
        event,
        lambda: json_response(
            event,
            200,
            {
                "ok": True,
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "service": "certstack-api",
            },
        ),
    )
