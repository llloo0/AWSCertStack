"""内容包读取：S3 上的 index.json 与每门考试的 meta.json。

Lambda 只需要 meta（题目 ID、正确答案、标签），不需要完整题干，
所以单个对象只有 ~100 KB，冷启动时读一次即可。
"""

from __future__ import annotations

import json
import os
import time

import boto3

from .http import HttpError

_s3 = boto3.client("s3")
_index_cache: dict | None = None
_index_at: float = 0.0
_meta_cache: dict[str, dict] = {}

INDEX_TTL_SECONDS = 300


def _get_json(key: str) -> dict:
    bucket = os.environ.get("CONTENT_BUCKET")
    if not bucket:
        raise HttpError(500, "CONFIG_ERROR", "CONTENT_BUCKET is not configured")
    try:
        obj = _s3.get_object(Bucket=bucket, Key=key)
    except _s3.exceptions.NoSuchKey:
        raise HttpError(502, "CONTENT_UNAVAILABLE", f"missing content object: {key}")
    return json.loads(obj["Body"].read().decode("utf-8"))


def content_index() -> dict:
    global _index_cache, _index_at
    if _index_cache is not None and time.time() - _index_at < INDEX_TTL_SECONDS:
        return _index_cache
    key = os.environ.get("CONTENT_INDEX_KEY", "content/index.json")
    _index_cache = _get_json(key)
    _index_at = time.time()
    return _index_cache


def exam_meta(exam: str) -> dict:
    cached = _meta_cache.get(exam)
    if cached is not None:
        return cached
    index = content_index()
    entry = (index.get("exams") or {}).get(exam)
    if not entry:
        raise HttpError(400, "UNKNOWN_EXAM", f"unknown exam: {exam}")
    meta = _get_json(f"{entry['basePath']}/meta.json")
    _meta_cache[exam] = meta
    return meta


def question_map(meta: dict) -> dict[str, dict]:
    return {q["id"]: q for q in meta["questions"]}
