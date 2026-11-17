"""练习闭环：建会话、逐题作答（幂等）、交卷判分。

路由：
  POST /api/sessions
  GET  /api/sessions
  GET  /api/sessions/{id}
  PUT  /api/sessions/{id}/answers/{qid}
  POST /api/sessions/{id}/finish
"""

from __future__ import annotations

import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from certstack.content import exam_meta, question_map
from certstack.db import (
    answer_sk,
    day_sk,
    now_iso,
    session_pk,
    session_sk,
    srs_gsi_pk,
    srs_sk,
    table,
    tagstat_sk,
    today_utc,
    user_pk,
)
from certstack.http import HttpError, body_json, json_response, require_user, run
from certstack.profiles import bump_on_answer, bump_sessions_finished, get_or_create_profile
from certstack.srs import compute_next_card


def _iso_in(seconds: int) -> str:
    when = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    return when.isoformat(timespec="seconds").replace("+00:00", "Z")


def _get_session(sub: str, session_id: str):
    return table().get_item(Key={"PK": user_pk(sub), "SK": session_sk(session_id)}).get("Item")


def _normalize(keys) -> list[str]:
    if not isinstance(keys, list):
        return []
    return sorted({str(k).lower() for k in keys if str(k).strip()})


def _conditional_failure(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


# --------------------------------------------------------------------------- 建会话
def _create(event):
    sub = require_user(event)
    body = body_json(event)

    exam = body.get("exam")
    if not exam:
        raise HttpError(400, "MISSING_EXAM", "exam is required")
    mode = "exam" if body.get("mode") == "exam" else "practice"

    meta = exam_meta(exam)
    cfg = meta["config"]

    if mode == "exam":
        requested = int(cfg["totalQuestions"])
    else:
        requested = body.get("count", 20)
        if not isinstance(requested, int) or not 1 <= requested <= 100:
            raise HttpError(400, "INVALID_COUNT", "count must be an integer between 1 and 100")

    tags = [str(t) for t in (body.get("tags") or [])]
    pool = meta["questions"]
    if tags:
        wanted = set(tags)
        pool = [q for q in pool if wanted.intersection(q["tags"])]
    if not pool:
        raise HttpError(400, "NO_QUESTIONS", "no questions match the selected filters")

    picked = random.sample(pool, min(requested, len(pool)))
    session_id = str(uuid.uuid4())
    duration_seconds = cfg["minutes"] * 60 if mode == "exam" else max(600, len(picked) * 60)

    item = {
        "PK": user_pk(sub),
        "SK": session_sk(session_id),
        "entity": "SESSION",
        "id": session_id,
        "exam": exam,
        "mode": mode,
        "status": "active",
        "questionIds": [q["id"] for q in picked],
        "count": len(picked),
        "tags": tags,
        "startedAt": now_iso(),
        "deadlineAt": _iso_in(duration_seconds),
        "durationSeconds": duration_seconds,
    }
    get_or_create_profile(sub)
    table().put_item(Item=item)

    return json_response(
        event,
        201,
        {
            "id": session_id,
            "exam": exam,
            "mode": mode,
            "count": len(picked),
            "questionIds": item["questionIds"],
            "startedAt": item["startedAt"],
            "deadlineAt": item["deadlineAt"],
            "durationSeconds": duration_seconds,
            "passingScore": cfg["passingScore"],
        },
    )


# --------------------------------------------------------------------------- 列表 / 详情
def _list(event):
    sub = require_user(event)
    raw_limit = (event.get("queryStringParameters") or {}).get("limit", "20")
    try:
        limit = max(1, min(int(raw_limit), 50))
    except (TypeError, ValueError):
        limit = 20

    res = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("SESSION#"),
        ScanIndexForward=False,
        Limit=limit,
    )
    return json_response(
        event,
        200,
        {
            "sessions": [
                {
                    "id": item.get("id"),
                    "exam": item.get("exam"),
                    "mode": item.get("mode"),
                    "status": item.get("status"),
                    "count": item.get("count"),
                    "correctCount": item.get("correctCount"),
                    "score": item.get("score"),
                    "startedAt": item.get("startedAt"),
                    "finishedAt": item.get("finishedAt"),
                }
                for item in res.get("Items", [])
            ]
        },
    )


def _detail(event):
    sub = require_user(event)
    session_id = (event.get("pathParameters") or {}).get("id")
    if not session_id:
        raise HttpError(400, "MISSING_ID", "session id is required")
    session = _get_session(sub, session_id)
    if not session:
        raise HttpError(404, "SESSION_NOT_FOUND", "session not found")

    answers = table().query(
        KeyConditionExpression=Key("PK").eq(session_pk(sub, session_id)) & Key("SK").begins_with("ANSWER#"),
    )
    return json_response(event, 200, {"session": session, "answers": answers.get("Items", [])})


# --------------------------------------------------------------------------- 作答
def _record_progress(sub: str, exam: str, question: dict, is_correct: bool, elapsed_ms: int) -> None:
    prev = table().get_item(Key={"PK": user_pk(sub), "SK": srs_sk(question["id"])}).get("Item")
    nxt = compute_next_card(prev, is_correct, elapsed_ms)

    table().put_item(
        Item={
            "PK": user_pk(sub),
            "SK": srs_sk(question["id"]),
            "entity": "SRS",
            "questionId": question["id"],
            "exam": exam,
            "gsi1pk": srs_gsi_pk(sub),
            "gsi1sk": f"{nxt['dueAt']}#{question['id']}",
            "updatedAt": now_iso(),
            **nxt,
        }
    )

    table().update_item(
        Key={"PK": user_pk(sub), "SK": day_sk(today_utc())},
        UpdateExpression="SET entity = :entity, #date = :date, updatedAt = :now ADD answered :one, correct :score",
        ExpressionAttributeNames={"#date": "date"},
        ExpressionAttributeValues={
            ":entity": "DAY",
            ":date": today_utc(),
            ":now": now_iso(),
            ":one": 1,
            ":score": 1 if is_correct else 0,
        },
    )

    bump_on_answer(sub, is_correct)

    for tag in question.get("tags", []):
        table().update_item(
            Key={"PK": user_pk(sub), "SK": tagstat_sk(tag)},
            UpdateExpression="SET entity = :entity, tag = :tag, updatedAt = :now ADD answered :one, correct :score",
            ExpressionAttributeValues={
                ":entity": "TAGSTAT",
                ":tag": tag,
                ":now": now_iso(),
                ":one": 1,
                ":score": 1 if is_correct else 0,
            },
        )


def _answer(event):
    sub = require_user(event)
    params = event.get("pathParameters") or {}
    session_id, question_id = params.get("id"), params.get("qid")
    if not session_id or not question_id:
        raise HttpError(400, "MISSING_PARAMS", "session id and question id are required")

    session = _get_session(sub, session_id)
    if not session:
        raise HttpError(404, "SESSION_NOT_FOUND", "session not found")
    if session.get("status") != "active":
        raise HttpError(409, "SESSION_FINISHED", "session already finished")
    if question_id not in (session.get("questionIds") or []):
        raise HttpError(400, "QUESTION_NOT_IN_SESSION", "question does not belong to this session")

    meta = exam_meta(session["exam"])
    question = question_map(meta).get(question_id)
    if not question:
        raise HttpError(404, "QUESTION_NOT_FOUND", "question not found in content")

    body = body_json(event)
    selected = _normalize(body.get("selected"))
    correct_keys = _normalize(question["correct"])
    is_correct = selected == correct_keys
    reveal = session.get("mode") == "practice"

    try:
        elapsed_raw = int(body.get("elapsedMs") or 0)
    except (TypeError, ValueError):
        elapsed_raw = 0
    elapsed_ms = max(0, min(elapsed_raw, 3_600_000))

    item = {
        "PK": session_pk(sub, session_id),
        "SK": answer_sk(question_id),
        "entity": "ANSWER",
        "questionId": question_id,
        "sessionId": session_id,
        "exam": session["exam"],
        "selected": selected,
        "isCorrect": is_correct,
        "elapsedMs": elapsed_ms,
        "createdAt": now_iso(),
    }

    try:
        table().put_item(Item=item, ConditionExpression="attribute_not_exists(SK)")
    except ClientError as err:
        if not _conditional_failure(err):
            raise
        previous = table().get_item(
            Key={"PK": session_pk(sub, session_id), "SK": answer_sk(question_id)}
        )["Item"]
        return json_response(
            event,
            200,
            {
                "saved": True,
                "duplicate": True,
                "correct": previous.get("isCorrect") if reveal else None,
                "correctKeys": correct_keys if reveal else None,
            },
        )

    _record_progress(sub, session["exam"], question, is_correct, elapsed_ms)

    return json_response(
        event,
        200,
        {
            "saved": True,
            "correct": is_correct if reveal else None,
            "correctKeys": correct_keys if reveal else None,
            "answeredAt": item["createdAt"],
        },
    )


# --------------------------------------------------------------------------- 交卷
def _finish(event):
    sub = require_user(event)
    session_id = (event.get("pathParameters") or {}).get("id")
    if not session_id:
        raise HttpError(400, "MISSING_ID", "session id is required")

    session = _get_session(sub, session_id)
    if not session:
        raise HttpError(404, "SESSION_NOT_FOUND", "session not found")

    answers = table().query(
        KeyConditionExpression=Key("PK").eq(session_pk(sub, session_id)) & Key("SK").begins_with("ANSWER#"),
    ).get("Items", [])

    total = len(answers)
    correct_count = sum(1 for a in answers if a.get("isCorrect"))
    score = round(100 + correct_count / total * 900) if total else 0

    meta = exam_meta(session["exam"])
    by_id = question_map(meta)

    tag_breakdown: dict[str, dict] = {}
    section_breakdown: dict[str, dict] = {}
    for answer in answers:
        question = by_id.get(answer.get("questionId"))
        if not question:
            continue
        for tag in question.get("tags", []):
            bucket = tag_breakdown.setdefault(tag, {"total": 0, "correct": 0})
            bucket["total"] += 1
            bucket["correct"] += 1 if answer.get("isCorrect") else 0
        section = question.get("section", "")
        bucket = section_breakdown.setdefault(section, {"total": 0, "correct": 0})
        bucket["total"] += 1
        bucket["correct"] += 1 if answer.get("isCorrect") else 0

    if session.get("status") == "active":
        table().update_item(
            Key={"PK": user_pk(sub), "SK": session_sk(session_id)},
            UpdateExpression=(
                "SET #status = :status, finishedAt = :now, score = :score, "
                "correctCount = :correct, answered = :total"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "finished",
                ":now": now_iso(),
                ":score": score,
                ":correct": correct_count,
                ":total": total,
            },
        )
        bump_sessions_finished(sub)

    return json_response(
        event,
        200,
        {
            "sessionId": session_id,
            "exam": session["exam"],
            "mode": session.get("mode"),
            "score": score,
            "passed": score >= int(meta["config"]["passingScore"]),
            "passingScore": int(meta["config"]["passingScore"]),
            "correctCount": correct_count,
            "total": total,
            "durationSeconds": session.get("durationSeconds"),
            "tagBreakdown": sorted(
                (
                    {
                        "tag": tag,
                        "total": value["total"],
                        "correct": value["correct"],
                        "accuracy": round(value["correct"] / value["total"] * 100),
                    }
                    for tag, value in tag_breakdown.items()
                ),
                key=lambda t: t["total"],
                reverse=True,
            ),
            "sectionBreakdown": [
                {"section": section, "total": value["total"], "correct": value["correct"]}
                for section, value in section_breakdown.items()
            ],
        },
    )


def handler(event, context):
    def dispatch():
        route = event.get("routeKey")
        if route == "POST /api/sessions":
            return _create(event)
        if route == "GET /api/sessions":
            return _list(event)
        if route == "GET /api/sessions/{id}":
            return _detail(event)
        if route == "PUT /api/sessions/{id}/answers/{qid}":
            return _answer(event)
        if route == "POST /api/sessions/{id}/finish":
            return _finish(event)
        raise HttpError(404, "NOT_FOUND", f"no route for {route}")

    return run(event, dispatch)
