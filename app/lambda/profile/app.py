"""GET/PATCH /api/me, GET /api/stats"""

from __future__ import annotations

import re

from boto3.dynamodb.conditions import Key
from certstack.db import day_sk, now_iso, srs_gsi_pk, table, today_utc, user_pk
from certstack.http import HttpError, body_json, json_response, require_user, run
from certstack.profiles import get_or_create_profile, get_settings, save_settings


def _me(event):
    sub = require_user(event)
    profile = get_or_create_profile(sub)
    settings = get_settings(sub)

    due_items = table().query(
        IndexName="gsi1",
        KeyConditionExpression=Key("gsi1pk").eq(srs_gsi_pk(sub)) & Key("gsi1sk").lte(now_iso()),
        Limit=100,
    ).get("Items", [])
    due_today = sum(1 for item in due_items if item.get("exam") == settings.get("targetExam"))
    sessions = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("SESSION#"),
        ScanIndexForward=False,
        Limit=5,
    )
    day = table().get_item(Key={"PK": user_pk(sub), "SK": day_sk(today_utc())})

    total_answered = int(profile.get("totalAnswered", 0))
    total_correct = int(profile.get("totalCorrect", 0))
    recent = [
        {
            "id": item.get("id"),
            "exam": item.get("exam"),
            "mode": item.get("mode"),
            "status": item.get("status"),
            "score": item.get("score"),
            "correctCount": item.get("correctCount"),
            "total": item.get("count"),
            "startedAt": item.get("startedAt"),
            "finishedAt": item.get("finishedAt"),
        }
        for item in sessions.get("Items", [])
    ]

    return json_response(
        event,
        200,
        {
            "profile": {
                "displayName": profile.get("displayName", ""),
                "targetExam": profile.get("targetExam", ""),
                "totalAnswered": total_answered,
                "totalCorrect": total_correct,
                "sessionsFinished": int(profile.get("sessionsFinished", 0)),
                "createdAt": profile.get("createdAt"),
            },
            "settings": settings,
            "stats": {
                "accuracy": round(total_correct / total_answered * 100) if total_answered else 0,
                "dueToday": due_today,
                "answeredToday": int((day.get("Item") or {}).get("answered", 0)),
            },
            "recentSessions": recent,
        },
    )


def _patch_me(event):
    sub = require_user(event)
    body = body_json(event)

    language = body.get("language")
    if language is not None and language not in ("zh", "en"):
        raise HttpError(400, "INVALID_LANGUAGE", "language must be zh or en")
    daily_goal = body.get("dailyGoal")
    if daily_goal is not None and (not isinstance(daily_goal, int) or not 5 <= daily_goal <= 200):
        raise HttpError(400, "INVALID_DAILY_GOAL", "dailyGoal must be an integer between 5 and 200")
    target_exam = body.get("targetExam")
    if target_exam is not None and not re.fullmatch(r"[A-Z]{3}-C0\d", str(target_exam)):
        raise HttpError(400, "INVALID_EXAM", "targetExam must look like SAA-C03")

    get_or_create_profile(sub)
    settings = save_settings(
        sub,
        {"language": language, "dailyGoal": daily_goal, "targetExam": target_exam},
    )

    display_name = body.get("displayName")
    if target_exam is not None or display_name is not None:
        expr, values = [], {":now": now_iso()}
        if target_exam is not None:
            expr.append("targetExam = :exam")
            values[":exam"] = target_exam
        if display_name is not None:
            expr.append("displayName = :name")
            values[":name"] = str(display_name)[:60]
        table().update_item(
            Key={"PK": user_pk(sub), "SK": "PROFILE"},
            UpdateExpression="SET " + ", ".join(expr + ["lastActiveAt = :now"]),
            ExpressionAttributeValues=values,
        )

    return json_response(event, 200, {"settings": settings})


def _stats(event):
    sub = require_user(event)
    tags = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("TAGSTAT#"),
        Limit=200,
    )
    days = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("DAY#"),
        ScanIndexForward=False,
        Limit=30,
    )

    tag_stats = []
    for item in tags.get("Items", []):
        answered = int(item.get("answered", 0))
        correct = int(item.get("correct", 0))
        if not answered:
            continue
        tag_stats.append(
            {
                "tag": item.get("tag", ""),
                "answered": answered,
                "correct": correct,
                "accuracy": round(correct / answered * 100),
            }
        )
    tag_stats.sort(key=lambda t: t["answered"], reverse=True)

    day_stats = [
        {
            "date": item.get("date", str(item.get("SK", "")).replace("DAY#", "")),
            "answered": int(item.get("answered", 0)),
            "correct": int(item.get("correct", 0)),
        }
        for item in reversed(days.get("Items", []))
    ]

    return json_response(event, 200, {"tagStats": tag_stats, "days": day_stats})


def handler(event, context):
    def dispatch():
        route = event.get("routeKey")
        if route == "GET /api/me":
            return _me(event)
        if route == "PATCH /api/me":
            return _patch_me(event)
        if route == "GET /api/stats":
            return _stats(event)
        raise HttpError(404, "NOT_FOUND", f"no route for {route}")

    return run(event, dispatch)
