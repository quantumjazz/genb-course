"""SQLite schema + connection helper for session-quiz.

Mirrors the style of the labor-auction-sim sibling project: single schema
string, WAL mode, row_factory = Row, threadsafe connection per thread.
"""

import sqlite3


SCHEMA = """
CREATE TABLE IF NOT EXISTS bank (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  uploaded_at     INTEGER NOT NULL,
  source_filename TEXT
);

CREATE TABLE IF NOT EXISTS bank_item (
  id            TEXT PRIMARY KEY,
  bank_id       TEXT NOT NULL REFERENCES bank(id) ON DELETE CASCADE,
  lecture_tag   TEXT NOT NULL,
  stem          TEXT NOT NULL,
  options_json  TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation   TEXT
);

CREATE INDEX IF NOT EXISTS idx_bank_item_bank_tag
  ON bank_item (bank_id, lecture_tag);

CREATE TABLE IF NOT EXISTS quiz_session (
  id                TEXT PRIMARY KEY,
  join_code         TEXT UNIQUE NOT NULL,
  bank_id           TEXT NOT NULL REFERENCES bank(id),
  lecture_tag       TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  item_count        INTEGER NOT NULL,
  duration_minutes  INTEGER NOT NULL,
  swap_policy       TEXT NOT NULL,
  permutation       TEXT NOT NULL,
  feedback          TEXT NOT NULL,
  exhaustion_policy TEXT NOT NULL,
  security_mode     TEXT NOT NULL DEFAULT 'standard',
  pseudonym_key     BLOB NOT NULL,
  created_at        INTEGER NOT NULL,
  started_at        INTEGER,
  closed_at         INTEGER,
  status            TEXT NOT NULL
    CHECK(status IN ('setup','lobby','live','closed'))
);

CREATE TABLE IF NOT EXISTS quiz_student (
  session_id      TEXT NOT NULL REFERENCES quiz_session(id) ON DELETE CASCADE,
  student_token   TEXT NOT NULL,
  student_number  TEXT NOT NULL,
  joined_at       INTEGER NOT NULL,
  ended_at        INTEGER,
  end_reason      TEXT,
  PRIMARY KEY (session_id, student_token)
);

CREATE TABLE IF NOT EXISTS quiz_attempt (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL,
  student_token     TEXT NOT NULL,
  bank_item_id      TEXT NOT NULL,
  ord               INTEGER,
  option_order_json TEXT NOT NULL,
  chosen_index      INTEGER,
  correct           INTEGER,
  served_at         INTEGER NOT NULL,
  submitted_at      INTEGER,
  swapped           INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id, student_token)
    REFERENCES quiz_student(session_id, student_token) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempt_session_student
  ON quiz_attempt (session_id, student_token);

CREATE TABLE IF NOT EXISTS quiz_incident (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  student_token  TEXT NOT NULL,
  attempt_id     TEXT,
  event_type     TEXT NOT NULL,
  client_ts      INTEGER,
  server_ts      INTEGER NOT NULL,
  metadata_json  TEXT NOT NULL,
  FOREIGN KEY (session_id, student_token)
    REFERENCES quiz_student(session_id, student_token) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_session_student
  ON quiz_incident (session_id, student_token);
"""


def connect(db_path):
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


def init_schema(conn):
    with conn:
        conn.executescript(SCHEMA)
        _ensure_column(
            conn,
            "quiz_session",
            "security_mode",
            "TEXT NOT NULL DEFAULT 'standard'",
        )


def _ensure_column(conn, table, column, definition):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row["name"] == column for row in rows):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
