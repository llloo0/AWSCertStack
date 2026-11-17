"""HTTP 辅助：响应、错误、鉴权主体、请求体解析。"""

from __future__ import annotations

import json
import logging
import os
from decimal import Decimal

logger = logging.getLogger("certstack")
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


class HttpError(Exception):
    """带状态码的业务错误，run() 会把它转成 JSON 响应。"""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _cors_headers(event: dict) -> dict:
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin")
    if not origin:
        return {}
    allowed = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if origin in allowed or origin.endswith(".cloudfront.net"):
        return {"access-control-allow-origin": origin, "vary": "Origin"}
    return {}


def _json_default(value):
    # DynamoDB 的 Number 会以 Decimal 返回，json.dumps 需要显式转换。
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def json_response(event: dict, status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            **_cors_headers(event),
        },
        "body": json.dumps(body, ensure_ascii=False, default=_json_default),
    }


def require_user(event: dict) -> str:
    """从 API Gateway HTTP API 的 JWT 授权器结果里取 sub。"""
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    except (KeyError, TypeError):
        raise HttpError(401, "UNAUTHENTICATED", "missing JWT claims")
    sub = claims.get("sub")
    if not sub:
        raise HttpError(401, "UNAUTHENTICATED", "missing JWT subject")
    return sub


def body_json(event: dict) -> dict:
    raw = event.get("body") or ""
    if not raw:
        raise HttpError(400, "EMPTY_BODY", "request body is required")
    if event.get("isBase64Encoded"):
        import base64

        raw = base64.b64decode(raw).decode("utf-8")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HttpError(400, "INVALID_JSON", "request body must be valid JSON")
    if not isinstance(parsed, dict):
        raise HttpError(400, "INVALID_BODY", "request body must be a JSON object")
    return parsed


def run(event: dict, fn) -> dict:
    """统一异常处理，避免把堆栈泄露给客户端。"""
    request_id = (event.get("requestContext") or {}).get("requestId")
    try:
        return fn()
    except HttpError as err:
        return json_response(
            event,
            err.status,
            {"error": {"code": err.code, "message": err.message, "requestId": request_id}},
        )
    except Exception:  # noqa: BLE001 - 兜底，记录完整堆栈
        logger.exception(
            "unhandled error",
            extra={"requestId": request_id, "routeKey": event.get("routeKey")},
        )
        return json_response(
            event,
            500,
            {"error": {"code": "INTERNAL_ERROR", "message": "internal error", "requestId": request_id}},
        )
