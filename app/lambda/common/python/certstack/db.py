"""DynamoDB 访问与键约定。

单表模型（详见 docs/PLAN.md 6.2）：
  USER#<sub>                          PROFILE / SETTINGS / SESSION#id / SRS#qid / BOOKMARK#qid /
                                      TAGSTAT#tag / DAY#yyyy-mm-dd
  USER#<sub>#SESSION#<id>             ANSWER#qid
GSI1（稀疏）: gsi1pk = USER#<sub>#SRS, gsi1sk = <dueAt>#<qid>
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import boto3

_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return _table


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def user_pk(sub: str) -> str:
    return f"USER#{sub}"


def session_sk(session_id: str) -> str:
    return f"SESSION#{session_id}"


def session_pk(sub: str, session_id: str) -> str:
    return f"USER#{sub}#SESSION#{session_id}"


def answer_sk(question_id: str) -> str:
    return f"ANSWER#{question_id}"


def srs_sk(question_id: str) -> str:
    return f"SRS#{question_id}"


def srs_gsi_pk(sub: str) -> str:
    return f"USER#{sub}#SRS"


def srs_gsi_sk(due_at: str, question_id: str) -> str:
    return f"{due_at}#{question_id}"


def bookmark_sk(question_id: str) -> str:
    return f"BOOKMARK#{question_id}"


def tagstat_sk(tag: str) -> str:
    return f"TAGSTAT#{tag}"


def day_sk(day: str) -> str:
    return f"DAY#{day}"
