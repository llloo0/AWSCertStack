"""间隔复习队列与书签。

路由：
  GET    /api/srs/due
  GET    /api/bookmarks
  PUT    /api/bookmarks/{qid}
  DELETE /api/bookmarks/{qid}
"""

from __future__ import annotations

from boto3.dynamodb.conditions import Attr, Key

from certstack.db import bookmark_sk, now_iso, srs_gsi_pk, table, user_pk
from certstack.http import HttpError, body_json, json_response, require_user, run


def _due(event):
    sub = require_user(event)
    params = event.get("queryStringParameters") or {}

    try:
        limit = max(1, min(int(params.get("limit", "20")), 100))
    except (TypeError, ValueError):
        limit = 20

    kwargs = {
        "IndexName": "gsi1",
        "KeyConditionExpression": Key("gsi1pk").eq(srs_gsi_pk(sub)) & Key("gsi1sk").lte(now_iso()),
        "Limit": limit,
    }
    exam = params.get("exam")
    if exam:
        kwargs["FilterExpression"] = Attr("exam").eq(exam)

    res = table().query(**kwargs)
    return json_response(
        event,
        200,
        {
            "items": [
                {
                    "questionId": item.get("questionId"),
                    "exam": item.get("exam"),
                    "dueAt": item.get("dueAt"),
                    "intervalDays": int(item.get("intervalDays", 1)),
                    "ease": item.get("ease"),
                    "lapses": int(item.get("lapses", 0)),
                    "lastResult": item.get("lastResult"),
                }
                for item in res.get("Items", [])
            ],
            "count": int(res.get("Count", 0)),
        },
    )


def _list_bookmarks(event):
    sub = require_user(event)
    res = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("BOOKMARK#"),
        ScanIndexForward=False,
        Limit=200,
    )
    return json_response(
        event,
        200,
        {
            "items": [
                {
                    "questionId": item.get("questionId"),
                    "exam": item.get("exam", ""),
                    "note": item.get("note", ""),
                    "createdAt": item.get("createdAt"),
                }
                for item in res.get("Items", [])
            ]
        },
    )


def _put_bookmark(event):
    sub = require_user(event)
    question_id = (event.get("pathParameters") or {}).get("qid")
    if not question_id:
        raise HttpError(400, "MISSING_QID", "question id is required")
    body = body_json(event)

    table().put_item(
        Item={
            "PK": user_pk(sub),
            "SK": bookmark_sk(question_id),
            "entity": "BOOKMARK",
            "questionId": question_id,
            "exam": body.get("exam", ""),
            "note": str(body.get("note", ""))[:2000],
            "createdAt": now_iso(),
        }
    )
    return json_response(event, 200, {"saved": True})


def _delete_bookmark(event):
    sub = require_user(event)
    question_id = (event.get("pathParameters") or {}).get("qid")
    if not question_id:
        raise HttpError(400, "MISSING_QID", "question id is required")
    table().delete_item(Key={"PK": user_pk(sub), "SK": bookmark_sk(question_id)})
    return json_response(event, 200, {"deleted": True})


def handler(event, context):
    def dispatch():
        route = event.get("routeKey")
        if route == "GET /api/srs/due":
            return _due(event)
        if route == "GET /api/bookmarks":
            return _list_bookmarks(event)
        if route == "PUT /api/bookmarks/{qid}":
            return _put_bookmark(event)
        if route == "DELETE /api/bookmarks/{qid}":
            return _delete_bookmark(event)
        raise HttpError(404, "NOT_FOUND", f"no route for {route}")

    return run(event, dispatch)
