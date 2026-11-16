#!/usr/bin/env python3
"""Export the SQLite quiz bank into the static content bundle used by the app.

The bundle is the single input for:
  * the SPA (loaded lazily per exam, cached in IndexedDB)
  * the Lambda API (answer-key validation, AI prompts)
  * the ingestion pipeline (S3 -> Step Functions -> publish)

Usage:
  python3 data/export_content.py                      # all exams -> data/dist
  python3 data/export_content.py --exams SAA-C03      # one exam
  python3 data/export_content.py --out /tmp/bundle
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "aws-quiz.db"
DEFAULT_OUT = ROOT / "data" / "dist"
EXAMS_FILE = ROOT / "data" / "exams.json"

GENERATOR = "certstack-export/1.0.0"

BLOCK_TAGS = re.compile(r"</?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|blockquote)\b[^>]*>", re.I)
ANY_TAG = re.compile(r"<[^>]+>")
WS = re.compile(r"[ \t\r\f\v]+")
MULTI_NL = re.compile(r"\n{3,}")


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    text = BLOCK_TAGS.sub("\n", value)
    text = ANY_TAG.sub("", text)
    text = html.unescape(text)
    text = WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return MULTI_NL.sub("\n\n", text).strip()


def norm_html(value: str | None) -> str:
    if not value:
        return ""
    return value.strip()


def stable_hash(payload: object) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_exam_configs() -> dict:
    with EXAMS_FILE.open(encoding="utf-8") as fh:
        return json.load(fh)


def fetch_questions(conn: sqlite3.Connection, exam_code: str) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """
        SELECT q.id, q.position, q.assessment_type, q.section,
               q.question_html, q.question_text, q.explanation_html, q.explanation_text,
               q.correct_response_json, q.raw_json,
               s.name AS set_name, s.exam_code
        FROM questions q
        JOIN quiz_sets s ON s.id = q.quiz_set_id
        WHERE s.exam_code = ?
        ORDER BY s.name, q.position, q.id
        """,
        (exam_code,),
    ).fetchall()


def build_question(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    qid = str(row["id"])

    options = conn.execute(
        "SELECT option_key, position, body_html, body_text FROM options WHERE question_id = ? ORDER BY position, option_key",
        (row["id"],),
    ).fetchall()
    tr = conn.execute(
        "SELECT id, question_html, question_text, explanation_html, explanation_text, translator, notes "
        "FROM question_translations WHERE question_id = ? AND language_code = 'zh-CN'",
        (row["id"],),
    ).fetchone()
    tr_opts = {}
    if tr is not None:
        for o in conn.execute(
            "SELECT option_key, body_html, body_text FROM question_translation_options WHERE translation_id = ?",
            (tr["id"],),
        ):
            tr_opts[o["option_key"]] = o

    tags = [
        r["name"]
        for r in conn.execute(
            "SELECT t.name FROM question_tags qt JOIN tags t ON t.id = qt.tag_id "
            "WHERE qt.question_id = ? ORDER BY t.name",
            (row["id"],),
        )
    ]

    try:
        correct = [str(k).lower() for k in json.loads(row["correct_response_json"] or "[]")]
    except json.JSONDecodeError:
        correct = []
    correct = [k for k in correct if any(o["option_key"] == k for o in options)]

    raw = {}
    try:
        raw = json.loads(row["raw_json"] or "{}")
    except json.JSONDecodeError:
        raw = {}

    q_type = "multi" if len(correct) > 1 else "single"

    out_options = []
    for o in options:
        key = o["option_key"]
        zh = tr_opts.get(key)
        en_text = (o["body_text"] or html_to_text(o["body_html"])).strip()
        option = {
            "key": key,
            "position": o["position"],
            "html": {"en": norm_html(o["body_html"])},
            "text": {"en": en_text},
        }
        if zh is not None:
            option["html"]["zh"] = norm_html(zh["body_html"])
            option["text"]["zh"] = (zh["body_text"] or html_to_text(zh["body_html"])).strip()
        out_options.append(option)

    explanation = {
        "en": (row["explanation_text"] or "").strip(),
        "enHtml": norm_html(row["explanation_html"]),
    }
    if tr is not None and (tr["explanation_text"] or tr["explanation_html"]):
        explanation["zh"] = (tr["explanation_text"] or "").strip()
        explanation["zhHtml"] = norm_html(tr["explanation_html"])

    prompt = (raw.get("prompt") or {}) if isinstance(raw, dict) else {}
    question = {
        "id": qid,
        "exam": row["exam_code"],
        "set": row["set_name"],
        "position": row["position"],
        "type": q_type,
        "section": row["section"] or "",
        "studyDomain": None,
        "difficulty": None,
        "stem": {
            "html": {
                "en": norm_html(row["question_html"]),
                **({"zh": norm_html(tr["question_html"])} if tr is not None and tr["question_html"] else {}),
            },
            "text": {
                "en": (row["question_text"] or html_to_text(row["question_html"])).strip(),
                **(
                    {"zh": (tr["question_text"] or html_to_text(tr["question_html"])).strip()}
                    if tr is not None and (tr["question_text"] or tr["question_html"])
                    else {}
                ),
            },
        },
        "options": out_options,
        "correct": correct,
        "explanation": explanation,
        "tags": tags,
        "source": {
            "url": prompt.get("source_url") or raw.get("source_url") or "",
            "answerSource": raw.get("answer_source", ""),
            "communityVotes": raw.get("community_answer_votes", ""),
        },
        "translation": {
            "available": tr is not None,
            "translator": tr["translator"] if tr is not None else None,
        },
    }
    question["hash"] = stable_hash(
        {
            "stem": question["stem"]["text"]["en"],
            "options": [o["text"]["en"] for o in out_options],
            "correct": correct,
            "explanation": explanation["en"],
        }
    )
    return question


def validate(exam_code: str, questions: list[dict]) -> list[str]:
    problems: list[str] = []
    seen: set[str] = set()
    for q in questions:
        qid = q["id"]
        if qid in seen:
            problems.append(f"{exam_code}/{qid}: duplicate id")
        seen.add(qid)
        if not q["stem"]["text"]["en"]:
            problems.append(f"{exam_code}/{qid}: empty stem")
        keys = {o["key"] for o in q["options"]}
        if len(keys) < 2:
            problems.append(f"{exam_code}/{qid}: fewer than 2 options")
        if len(keys) != len(q["options"]):
            problems.append(f"{exam_code}/{qid}: duplicate option keys")
        if not q["correct"]:
            problems.append(f"{exam_code}/{qid}: no correct answer")
        missing = set(q["correct"]) - keys
        if missing:
            problems.append(f"{exam_code}/{qid}: correct keys not in options {sorted(missing)}")
        if q["type"] == "single" and len(q["correct"]) != 1:
            problems.append(f"{exam_code}/{qid}: single-choice with {len(q['correct'])} correct")
        if q["type"] == "multi" and len(q["correct"]) < 2:
            problems.append(f"{exam_code}/{qid}: multi-select with <2 correct")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--exams", default="", help="comma separated exam codes (default: all in DB)")
    args = ap.parse_args()

    db_path = Path(args.db).resolve()
    out_dir = Path(args.out).resolve()
    if not db_path.exists():
        print(f"database not found: {db_path}", file=sys.stderr)
        return 1

    exam_configs = load_exam_configs()
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    available = [r[0] for r in conn.execute("SELECT DISTINCT exam_code FROM quiz_sets ORDER BY exam_code")]
    wanted = [e.strip() for e in args.exams.split(",") if e.strip()] or available
    unknown = [e for e in wanted if e not in exam_configs]
    if unknown:
        print(f"no config in data/exams.json for: {unknown}", file=sys.stderr)
        return 1

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    content_root = out_dir / "content"
    if content_root.exists():
        shutil.rmtree(content_root)
    content_root.mkdir(parents=True, exist_ok=True)

    manifest = {
        "generator": GENERATOR,
        "generatedAt": generated_at,
        "sourceDb": db_path.name,
        "exams": {},
    }
    index = {"generatedAt": generated_at, "exams": {}}
    all_problems: list[str] = []
    totals = {}

    for exam_code in wanted:
        rows = fetch_questions(conn, exam_code)
        if not rows:
            print(f"warn: no questions for {exam_code}", file=sys.stderr)
            continue
        questions = [build_question(conn, row) for row in rows]
        all_problems.extend(validate(exam_code, questions))

        digest = stable_hash(questions)
        version = digest[:8]
        exam_dir = content_root / exam_code / version
        exam_dir.mkdir(parents=True, exist_ok=True)

        payload = {
            "exam": exam_code,
            "config": exam_configs[exam_code],
            "generatedAt": generated_at,
            "version": version,
            "count": len(questions),
            "questions": questions,
        }
        exam_file = exam_dir / "questions.json"
        exam_file.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        # Lambda 只需要这些字段：抽题、判分、按域/标签统计。体积极小，冷启动友好。
        meta = {
            "exam": exam_code,
            "version": version,
            "count": len(questions),
            "config": exam_configs[exam_code],
            "questions": [
                {
                    "id": q["id"],
                    "position": q["position"],
                    "type": q["type"],
                    "section": q["section"],
                    "correct": q["correct"],
                    "tags": q["tags"],
                }
                for q in questions
            ],
        }
        meta_file = exam_dir / "meta.json"
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        tag_counts: dict[str, int] = {}
        for q in questions:
            for tag in q["tags"]:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

        entry = {
            "count": len(questions),
            "version": version,
            "basePath": f"content/{exam_code}/{version}",
            "translated": sum(1 for q in questions if q["translation"]["available"]),
            "withExplanation": sum(1 for q in questions if q["explanation"]["en"] or q["explanation"].get("zh")),
            "multiSelect": sum(1 for q in questions if q["type"] == "multi"),
            "tags": dict(sorted(tag_counts.items(), key=lambda kv: (-kv[1], kv[0]))),
            "sets": sorted({q["set"] for q in questions}),
        }
        index["exams"][exam_code] = entry
        manifest["exams"][exam_code] = {
            **entry,
            "hash": digest,
            "questionsFile": f"content/{exam_code}/{version}/questions.json",
            "metaFile": f"content/{exam_code}/{version}/meta.json",
            "bytes": exam_file.stat().st_size,
            "metaBytes": meta_file.stat().st_size,
        }
        totals[exam_code] = len(questions)

    conn.close()

    index_file = content_root / "index.json"
    index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    (content_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'exam':10} {'count':>6} {'MB':>7} {'metaKB':>7} {'zh':>6} {'expl':>6} {'multi':>6}")
    for exam_code, meta in manifest["exams"].items():
        print(
            f"{exam_code:10} {meta['count']:6d} {meta['bytes'] / 1e6:7.2f} {meta['metaBytes'] / 1e3:7.0f} "
            f"{meta['translated']:6d} {meta['withExplanation']:6d} {meta['multiSelect']:6d}"
        )
    total_bytes = sum(m["bytes"] + m["metaBytes"] for m in manifest["exams"].values())
    print(f"\ntotal {sum(totals.values())} questions, {total_bytes / 1e6:.2f} MB uncompressed")

    if all_problems:
        print(f"\n{len(all_problems)} validation problem(s):", file=sys.stderr)
        for p in all_problems[:50]:
            print(f"  - {p}", file=sys.stderr)
        return 2
    print("validation: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
