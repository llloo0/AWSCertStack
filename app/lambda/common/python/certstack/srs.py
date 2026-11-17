"""SM-2 简化版间隔复习。

  - 答对：间隔乘 ease，ease 缓慢上升（上限 2.8）
  - 答对但明显偏慢：只乘 1.2，不给 ease 奖励
  - 答错：间隔回到 1 天，ease 下调（下限 1.3），10 分钟后再出现
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from decimal import Decimal

DAY_MS = 86_400_000
RELEARN_MS = 10 * 60_000
MIN_EASE = 1.3
MAX_EASE = 2.8


def _iso(epoch_ms: int) -> str:
    return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def compute_next_card(
    prev: dict | None,
    correct: bool,
    elapsed_ms: int = 0,
    median_ms: int = 0,
) -> dict:
    now_ms = int(time.time() * 1000)

    if not prev:
        return {
            "intervalDays": 1,
            "ease": Decimal("2.5") if correct else Decimal("2.3"),
            "lapses": 0 if correct else 1,
            "reps": 1,
            "lastResult": "correct" if correct else "wrong",
            "dueAt": _iso(now_ms + (DAY_MS if correct else RELEARN_MS)),
        }

    interval = int(prev.get("intervalDays", 1))
    ease = float(prev.get("ease", 2.5))
    lapses = int(prev.get("lapses", 0))
    reps = int(prev.get("reps", 0)) + 1

    if correct:
        slow = elapsed_ms > 0 and median_ms > 0 and elapsed_ms > median_ms * 1.5
        interval = max(1, round(interval * 1.2)) if slow else max(1, round(interval * ease))
        if not slow:
            ease = min(MAX_EASE, ease + 0.05)
    else:
        interval = 1
        ease = max(MIN_EASE, ease - 0.2)
        lapses += 1

    return {
        "intervalDays": interval,
        "ease": Decimal(str(round(ease, 2))),
        "lapses": lapses,
        "reps": reps,
        "lastResult": "correct" if correct else "wrong",
        "dueAt": _iso(now_ms + (interval * DAY_MS if correct else RELEARN_MS)),
    }
