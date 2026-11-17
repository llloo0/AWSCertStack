"""用户资料、设置与累计计数。"""

from __future__ import annotations

from botocore.exceptions import ClientError

from .db import now_iso, table, user_pk

PROFILE_SK = "PROFILE"
SETTINGS_SK = "SETTINGS"
DEFAULT_SETTINGS = {"language": "zh", "dailyGoal": 20, "targetExam": "SAA-C03"}


def _conditional_failure(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def get_or_create_profile(sub: str) -> dict:
    key = {"PK": user_pk(sub), "SK": PROFILE_SK}
    found = table().get_item(Key=key)
    if "Item" in found:
        return found["Item"]

    now = now_iso()
    item = {
        "PK": user_pk(sub),
        "SK": PROFILE_SK,
        "entity": "PROFILE",
        "sub": sub,
        "displayName": "",
        "targetExam": DEFAULT_SETTINGS["targetExam"],
        "totalAnswered": 0,
        "totalCorrect": 0,
        "sessionsFinished": 0,
        "createdAt": now,
        "lastActiveAt": now,
    }
    try:
        table().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
        return item
    except ClientError as err:
        if not _conditional_failure(err):
            raise
        return table().get_item(Key=key)["Item"]


def get_settings(sub: str) -> dict:
    res = table().get_item(Key={"PK": user_pk(sub), "SK": SETTINGS_SK})
    item = res.get("Item") or {}
    return {
        "language": item.get("language", DEFAULT_SETTINGS["language"]),
        "dailyGoal": int(item.get("dailyGoal", DEFAULT_SETTINGS["dailyGoal"])),
        "targetExam": item.get("targetExam", DEFAULT_SETTINGS["targetExam"]),
    }


def save_settings(sub: str, patch: dict) -> dict:
    current = get_settings(sub)
    next_settings = {
        "language": patch.get("language") or current["language"],
        "dailyGoal": patch.get("dailyGoal") or current["dailyGoal"],
        "targetExam": patch.get("targetExam") or current["targetExam"],
    }
    table().update_item(
        Key={"PK": user_pk(sub), "SK": SETTINGS_SK},
        UpdateExpression=(
            "SET entity = :entity, #language = :language, dailyGoal = :dailyGoal, "
            "targetExam = :targetExam, updatedAt = :now"
        ),
        ExpressionAttributeNames={"#language": "language"},
        ExpressionAttributeValues={
            ":entity": "SETTINGS",
            ":language": next_settings["language"],
            ":dailyGoal": next_settings["dailyGoal"],
            ":targetExam": next_settings["targetExam"],
            ":now": now_iso(),
        },
    )
    return next_settings


def bump_on_answer(sub: str, correct: bool) -> None:
    table().update_item(
        Key={"PK": user_pk(sub), "SK": PROFILE_SK},
        UpdateExpression="SET entity = :entity, lastActiveAt = :now ADD totalAnswered :one, totalCorrect :score",
        ExpressionAttributeValues={
            ":entity": "PROFILE",
            ":now": now_iso(),
            ":one": 1,
            ":score": 1 if correct else 0,
        },
    )


def bump_sessions_finished(sub: str) -> None:
    table().update_item(
        Key={"PK": user_pk(sub), "SK": PROFILE_SK},
        UpdateExpression="SET entity = :entity, lastSessionAt = :now ADD sessionsFinished :one",
        ExpressionAttributeValues={":entity": "PROFILE", ":now": now_iso(), ":one": 1},
    )
