"""在本地用 moto 模拟 DynamoDB/S3，跑一遍 Lambda 处理器的核心链路。

用途：部署前先验证 Python 逻辑，避免把错误带到 CloudFormation 里。
运行：.venv/bin/pytest tests -q
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app" / "lambda" / "common" / "python"))

os.environ.setdefault("TABLE_NAME", "certstack-test")
os.environ.setdefault("CONTENT_BUCKET", "content-test")
os.environ.setdefault("CONTENT_INDEX_KEY", "content/index.json")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5173")
os.environ.setdefault("AWS_DEFAULT_REGION", "ap-northeast-1")

QUESTIONS = [
    {
        "id": "q1",
        "position": 1,
        "type": "single",
        "section": "Topic 1",
        "correct": ["a"],
        "tags": ["S3", "Performance"],
    },
    {
        "id": "q2",
        "position": 2,
        "type": "multi",
        "section": "Topic 1",
        "correct": ["a", "b"],
        "tags": ["EC2"],
    },
    {
        "id": "q3",
        "position": 3,
        "type": "single",
        "section": "Topic 1",
        "correct": ["c"],
        "tags": ["S3"],
    },
]

META = {
    "exam": "SAA-C03",
    "version": "v1",
    "count": len(QUESTIONS),
    "config": {
        "title": "SAA",
        "totalQuestions": 3,
        "minutes": 130,
        "passingScore": 720,
        "scoreScale": [100, 1000],
        "domains": [],
    },
    "questions": QUESTIONS,
}


def load_handler(name: str):
    path = ROOT / "app" / "lambda" / name / "app.py"
    spec = importlib.util.spec_from_file_location(f"handler_{name}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.handler


def ev(route: str, sub: str = "user-1", body=None, path=None, query=None):
    return {
        "routeKey": route,
        "requestContext": {
            "requestId": "req-1",
            "authorizer": {"jwt": {"claims": {"sub": sub}}},
        },
        "headers": {"origin": "http://localhost:5173"},
        "body": json.dumps(body) if body is not None else None,
        "pathParameters": path or {},
        "queryStringParameters": query or {},
    }


@pytest.fixture()
def aws():
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="ap-northeast-1")
        ddb.create_table(
            TableName="certstack-test",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
                {"AttributeName": "gsi1pk", "AttributeType": "S"},
                {"AttributeName": "gsi1sk", "AttributeType": "S"},
                {"AttributeName": "gsi2pk", "AttributeType": "S"},
                {"AttributeName": "gsi2sk", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "gsi1",
                    "KeySchema": [
                        {"AttributeName": "gsi1pk", "KeyType": "HASH"},
                        {"AttributeName": "gsi1sk", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": "gsi2",
                    "KeySchema": [
                        {"AttributeName": "gsi2pk", "KeyType": "HASH"},
                        {"AttributeName": "gsi2sk", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
            ],
        )

        s3 = boto3.client("s3", region_name="ap-northeast-1")
        s3.create_bucket(
            Bucket="content-test",
            CreateBucketConfiguration={"LocationConstraint": "ap-northeast-1"},
        )
        s3.put_object(
            Bucket="content-test",
            Key="content/index.json",
            Body=json.dumps(
                {
                    "generatedAt": "2026-01-01T00:00:00Z",
                    "exams": {
                        "SAA-C03": {"count": 3, "version": "v1", "basePath": "content/SAA-C03/v1"}
                    },
                }
            ),
        )
        s3.put_object(
            Bucket="content-test",
            Key="content/SAA-C03/v1/meta.json",
            Body=json.dumps(META),
        )

        # 内容模块有进程内缓存，测试之间要清掉
        import certstack.content as content

        content._index_cache = None
        content._meta_cache.clear()
        yield


def test_health(aws):
    handler = load_handler("health")
    resp = handler(ev("GET /api/health"), None)
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["ok"] is True


def test_unauthenticated_shape(aws):
    handler = load_handler("profile")
    event = ev("GET /api/me")
    event["requestContext"] = {"requestId": "req-1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 401


def test_full_practice_flow(aws):
    profile = load_handler("profile")
    sessions = load_handler("sessions")
    study = load_handler("study")

    me = json.loads(profile(ev("GET /api/me"), None)["body"])
    assert me["profile"]["totalAnswered"] == 0
    assert me["settings"]["targetExam"] == "SAA-C03"

    created_resp = sessions(ev("POST /api/sessions", body={"exam": "SAA-C03", "mode": "practice", "count": 3}), None)
    assert created_resp["statusCode"] == 201
    created = json.loads(created_resp["body"])
    assert created["count"] == 3
    session_id = created["id"]

    answers = []
    for question_id in created["questionIds"]:
        resp = sessions(
            ev(
                "PUT /api/sessions/{id}/answers/{qid}",
                body={"selected": ["a"], "elapsedMs": 4200},
                path={"id": session_id, "qid": question_id},
            ),
            None,
        )
        assert resp["statusCode"] == 200
        answers.append(json.loads(resp["body"]))

    assert "correct" in answers[0]

    duplicate = json.loads(
        sessions(
            ev(
                "PUT /api/sessions/{id}/answers/{qid}",
                body={"selected": ["a"], "elapsedMs": 4200},
                path={"id": session_id, "qid": created["questionIds"][0]},
            ),
            None,
        )["body"]
    )
    assert duplicate["duplicate"] is True

    finished = json.loads(
        sessions(ev("POST /api/sessions/{id}/finish", path={"id": session_id}), None)["body"]
    )
    assert finished["total"] == 3
    assert finished["score"] == round(100 + finished["correctCount"] / 3 * 900)
    assert finished["tagBreakdown"]

    stats = json.loads(profile(ev("GET /api/stats"), None)["body"])
    assert stats["days"][0]["answered"] == 3

    me = json.loads(profile(ev("GET /api/me"), None)["body"])
    assert me["profile"]["totalAnswered"] == 3
    assert me["recentSessions"][0]["status"] == "finished"

    # 把复习卡片改到过去，验证 GSI 到期查询
    ddb = boto3.resource("dynamodb", region_name="ap-northeast-1").Table("certstack-test")
    ddb.update_item(
        Key={"PK": "USER#user-1", "SK": f"SRS#{created['questionIds'][0]}"},
        UpdateExpression="SET gsi1sk = :past",
        ExpressionAttributeValues={":past": "2020-01-01T00:00:00Z#" + created["questionIds"][0]},
    )
    due = json.loads(study(ev("GET /api/srs/due", query={"limit": "10"}), None)["body"])
    assert due["count"] >= 1

    bookmark = study(
        ev("PUT /api/bookmarks/{qid}", body={"note": "再看一遍"}, path={"qid": "q1"}), None
    )
    assert json.loads(bookmark["body"])["saved"] is True
    bookmarks = json.loads(study(ev("GET /api/bookmarks"), None)["body"])
    assert bookmarks["items"][0]["note"] == "再看一遍"
    study(ev("DELETE /api/bookmarks/{qid}", path={"qid": "q1"}), None)
    assert json.loads(study(ev("GET /api/bookmarks"), None)["body"])["items"] == []
