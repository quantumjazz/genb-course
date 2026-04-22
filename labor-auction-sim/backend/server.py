#!/usr/bin/env python3
"""Labor auction classroom simulation backend.

Serves the instructor, student, and projection dashboards for the
efficiency-wage / shirking simulation described in
``../labor-auction-simulation-spec.md``.

Design mirrors the matching-dashboard sibling project: stdlib-only HTTP
server, SQLite storage, admin-protected mutation routes, and static
HTML/JS clients that poll / subscribe over SSE.
"""

import argparse
import base64
import csv
import hashlib
import hmac
import io
import json
import os
import queue
import random
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


# ---------------------------------------------------------------------------
# Constants and defaults
# ---------------------------------------------------------------------------

PHASES = {"lobby", "auction", "effort", "resolution", "ended"}

DEFAULT_PARAMS = {
    "t_rounds": 10,
    "w_outside": 1000,
    "g": 1500,
    "c_effort": 500,
    "firing_penalty_rounds": 1,
    "alpha": 1.0,
    "beta": 0.3,
    "w_max_multiplier": 2.0,
    "heterogeneous_g": False,
    "g_spread": 0.2,
    "duration_auction": 25,
    "duration_effort": 20,
    "duration_resolution": 15,
    "firm_types": [
        {
            "key": "small",
            "label": "Small shop",
            "count": 20,
            "base_wage": 1500,
            "monitoring": 0.10,
            "contract_length": 1,
            "monitoring_label": "loose monitoring",
            "contract_label": "short-term contract",
        },
        {
            "key": "mid",
            "label": "Mid-size firm",
            "count": 20,
            "base_wage": 2500,
            "monitoring": 0.25,
            "contract_length": 2,
            "monitoring_label": "standard monitoring",
            "contract_label": "medium-term contract",
        },
        {
            "key": "big",
            "label": "Big corporation",
            "count": 10,
            "base_wage": 4000,
            "monitoring": 0.50,
            "contract_length": 4,
            "monitoring_label": "strict monitoring",
            "contract_label": "long-term contract",
        },
    ],
}


SESSION_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # ambiguous chars removed
SESSION_CODE_LEN = 6
PSEUDONYM_KEY_BYTES = 32
TOKEN_LEN_CHARS = 12  # base32 chars from HMAC digest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def monotonic_now():
    return time.monotonic()


def json_dumps(value):
    return json.dumps(value, ensure_ascii=False)


def parse_json(body):
    if not body:
        return {}
    return json.loads(body.decode("utf-8"))


def make_session_code():
    return "".join(secrets.choice(SESSION_CODE_CHARS) for _ in range(SESSION_CODE_LEN))


def derive_student_token(pseudonym_key, faculty_id):
    """Deterministic per-session token derived from the faculty ID.

    Server-side pseudonymization: the faculty ID itself is never persisted.
    We HMAC the faculty ID with a random per-session key, then take the
    first TOKEN_LEN_CHARS base32 chars as the token. The same faculty ID
    in the same session always yields the same token (so reconnects work);
    different sessions produce unrelated tokens because each session has
    its own random key.
    """
    digest = hmac.new(pseudonym_key, faculty_id.encode("utf-8"),
                      hashlib.sha256).digest()
    b32 = base64.b32encode(digest).decode("ascii").rstrip("=")
    return b32[:TOKEN_LEN_CHARS]


_FACULTY_ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9\-]{1,31}$")


def normalize_faculty_id(value):
    if not isinstance(value, str):
        raise ValueError("Faculty ID must be text.")
    cleaned = value.strip().upper().replace(" ", "")
    if not cleaned:
        raise ValueError("Faculty ID cannot be empty.")
    if not _FACULTY_ID_RE.match(cleaned):
        raise ValueError(
            "Faculty ID must be 2-32 characters, letters/digits/hyphens only."
        )
    return cleaned


def normalize_display_name(value):
    if not isinstance(value, str):
        raise ValueError("Display name must be text.")
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        raise ValueError("Display name cannot be empty.")
    if len(cleaned) > 40:
        raise ValueError("Display name must be at most 40 characters.")
    return cleaned


# ---------------------------------------------------------------------------
# SQLite schema
# ---------------------------------------------------------------------------


SCHEMA = """
CREATE TABLE IF NOT EXISTS session (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT UNIQUE NOT NULL,
  created_at       TEXT NOT NULL,
  phase            TEXT NOT NULL DEFAULT 'lobby',
  paused           INTEGER NOT NULL DEFAULT 0,
  current_round    INTEGER NOT NULL DEFAULT 0,
  phase_ends_at    REAL,
  phase_remaining  REAL,
  params_json      TEXT NOT NULL,
  pending_params_json TEXT,
  pseudonym_key    BLOB NOT NULL,
  reveal_on        INTEGER NOT NULL DEFAULT 0,
  broadcast_msg    TEXT,
  broadcast_at     TEXT,
  ended_at         TEXT
);

CREATE TABLE IF NOT EXISTS student (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        INTEGER NOT NULL,
  token             TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  cumulative_earnings REAL NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'waiting',
  firing_penalty_remaining INTEGER NOT NULL DEFAULT 0,
  current_firm_id   INTEGER,
  current_wage      REAL,
  current_monitoring REAL,
  current_contract_length INTEGER,
  current_firm_type TEXT,
  current_firm_label TEXT,
  current_effort_choice TEXT,
  current_caught    INTEGER,
  current_earnings  REAL,
  g_i               REAL,
  last_round_completed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES session(id),
  UNIQUE (session_id, token)
);

CREATE INDEX IF NOT EXISTS idx_student_session ON student (session_id);

CREATE TABLE IF NOT EXISTS firm (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        INTEGER NOT NULL,
  firm_type         TEXT NOT NULL,
  firm_label        TEXT NOT NULL,
  monitoring_label  TEXT NOT NULL,
  contract_label    TEXT NOT NULL,
  slots_total       INTEGER NOT NULL,
  slots_filled      INTEGER NOT NULL DEFAULT 0,
  base_wage         REAL NOT NULL,
  current_wage      REAL NOT NULL,
  monitoring        REAL NOT NULL,
  contract_length   INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id)
);

CREATE INDEX IF NOT EXISTS idx_firm_session ON firm (session_id);

CREATE TABLE IF NOT EXISTS round_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         INTEGER NOT NULL,
  round              INTEGER NOT NULL,
  student_id         INTEGER NOT NULL,
  firm_id            INTEGER,
  firm_type          TEXT,
  firm_label         TEXT,
  wage               REAL NOT NULL,
  monitoring         REAL NOT NULL,
  contract_length    INTEGER NOT NULL,
  effort_choice      TEXT,
  caught             INTEGER,
  earnings           REAL NOT NULL,
  cumulative_earnings REAL NOT NULL,
  status             TEXT NOT NULL,
  logged_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_round_log_session_round ON round_log (session_id, round);
CREATE INDEX IF NOT EXISTS idx_round_log_student ON round_log (student_id);

CREATE TABLE IF NOT EXISTS firm_round (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL,
  round         INTEGER NOT NULL,
  firm_id       INTEGER NOT NULL,
  firm_type     TEXT NOT NULL,
  wage_posted   REAL NOT NULL,
  slots_total   INTEGER NOT NULL,
  n_hired       INTEGER NOT NULL DEFAULT 0,
  n_shirked     INTEGER NOT NULL DEFAULT 0,
  n_caught      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (firm_id, round)
);

CREATE INDEX IF NOT EXISTS idx_firm_round_session_round ON firm_round (session_id, round);

CREATE TABLE IF NOT EXISTS round_meta (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL,
  round           INTEGER NOT NULL,
  avg_wage        REAL,
  shirk_rate      REAL,
  unemployment_rate REAL,
  completed_at    TEXT,
  UNIQUE (session_id, round)
);
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
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(session)")
        }
        if "pending_params_json" not in columns:
            conn.execute(
                "ALTER TABLE session ADD COLUMN pending_params_json TEXT"
            )


# ---------------------------------------------------------------------------
# SSE event bus
# ---------------------------------------------------------------------------


class EventBus:
    """Per-session pub/sub queue used by SSE endpoints."""

    def __init__(self):
        self._lock = threading.Lock()
        self._subs = {}  # session_id -> set of Queue

    def subscribe(self, session_id):
        q = queue.Queue(maxsize=64)
        with self._lock:
            self._subs.setdefault(session_id, set()).add(q)
        return q

    def unsubscribe(self, session_id, q):
        with self._lock:
            subs = self._subs.get(session_id)
            if subs:
                subs.discard(q)
                if not subs:
                    self._subs.pop(session_id, None)

    def publish(self, session_id, payload):
        data = json_dumps(payload)
        with self._lock:
            subs = list(self._subs.get(session_id, ()))
        for q in subs:
            try:
                q.put_nowait(data)
            except queue.Full:
                pass


EVENT_BUS = EventBus()


# ---------------------------------------------------------------------------
# Session locking
# ---------------------------------------------------------------------------


class SessionLocks:
    """Ensures all mutations on a given session are serialized.

    SQLite with WAL can handle concurrent readers, but the round engine
    expects a consistent view when advancing phases. A session-scoped lock
    keeps Advance/Apply/Effort operations linearizable.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._locks = {}

    def get(self, session_id):
        with self._lock:
            lock = self._locks.get(session_id)
            if lock is None:
                lock = threading.Lock()
                self._locks[session_id] = lock
            return lock


SESSION_LOCKS = SessionLocks()


# ---------------------------------------------------------------------------
# Engine: round lifecycle, firm logic, payoffs
# ---------------------------------------------------------------------------


class Engine:
    def __init__(self, conn):
        self.conn = conn

    def _active_params(self, session):
        return json.loads(session["params_json"])

    def _pending_params(self, session):
        raw = session["pending_params_json"]
        return json.loads(raw) if raw else None

    def _next_params(self, session):
        return self._pending_params(session) or self._active_params(session)

    def _firm_types_changed(self, before, after):
        return (before or {}).get("firm_types", []) != (after or {}).get("firm_types", [])

    def _replace_firms(self, session_id, params):
        rows = []
        for firm_type in params["firm_types"]:
            for _ in range(int(firm_type["count"])):
                rows.append(
                    (
                        session_id,
                        firm_type["key"],
                        firm_type["label"],
                        firm_type["monitoring_label"],
                        firm_type["contract_label"],
                        1,
                        0,
                        float(firm_type["base_wage"]),
                        float(firm_type["base_wage"]),
                        float(firm_type["monitoring"]),
                        int(firm_type["contract_length"]),
                    )
                )
        with self.conn:
            self.conn.execute("DELETE FROM firm WHERE session_id = ?", (session_id,))
            self.conn.executemany(
                """INSERT INTO firm (session_id, firm_type, firm_label,
                    monitoring_label, contract_label, slots_total, slots_filled,
                    base_wage, current_wage, monitoring, contract_length)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )

    # -- Session CRUD -------------------------------------------------------

    def create_session(self, params_override=None):
        params = merge_params(DEFAULT_PARAMS, params_override or {})
        validate_params(params)
        live_sessions = self.list_live_sessions()
        if live_sessions:
            if len(live_sessions) == 1:
                raise ValueError(
                    f"Session {live_sessions[0]['code']} is already open. "
                    "Finish or delete it before creating another one."
                )
            raise ValueError(
                "More than one live session exists. Close or delete the extra sessions first."
            )
        pseudonym_key = secrets.token_bytes(PSEUDONYM_KEY_BYTES)
        # Try a few random codes until one is unique.
        for _ in range(16):
            code = make_session_code()
            try:
                with self.conn:
                    cur = self.conn.execute(
                        """INSERT INTO session (code, created_at, params_json, pseudonym_key)
                           VALUES (?, ?, ?, ?)""",
                        (code, utc_now(), json_dumps(params), pseudonym_key),
                    )
                    session_id = cur.lastrowid
                self._create_firms(session_id, params)
                return self.get_session(session_id)
            except sqlite3.IntegrityError:
                continue
        raise RuntimeError("Could not allocate a unique session code.")

    def _create_firms(self, session_id, params):
        rows = []
        for firm_type in params["firm_types"]:
            for _ in range(int(firm_type["count"])):
                rows.append(
                    (
                        session_id,
                        firm_type["key"],
                        firm_type["label"],
                        firm_type["monitoring_label"],
                        firm_type["contract_label"],
                        1,  # slots_total per firm instance = 1; firm count gives job count.
                        0,
                        float(firm_type["base_wage"]),
                        float(firm_type["base_wage"]),
                        float(firm_type["monitoring"]),
                        int(firm_type["contract_length"]),
                    )
                )
        with self.conn:
            self.conn.executemany(
                """INSERT INTO firm (session_id, firm_type, firm_label,
                    monitoring_label, contract_label, slots_total, slots_filled,
                    base_wage, current_wage, monitoring, contract_length)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )

    def get_session(self, session_id):
        row = self.conn.execute(
            "SELECT * FROM session WHERE id = ?", (session_id,)
        ).fetchone()
        return row

    def get_session_by_code(self, code):
        row = self.conn.execute(
            "SELECT * FROM session WHERE code = ?", (code.upper(),)
        ).fetchone()
        return row

    def list_sessions(self):
        return self.conn.execute(
            "SELECT * FROM session ORDER BY id DESC"
        ).fetchall()

    def list_live_sessions(self):
        return self.conn.execute(
            "SELECT * FROM session WHERE phase != 'ended' ORDER BY id DESC"
        ).fetchall()

    def get_current_session(self):
        rows = self.list_live_sessions()
        if not rows:
            raise ValueError("No class is open right now.")
        if len(rows) > 1:
            raise ValueError(
                "More than one live session exists. Ask the instructor to close the extras."
            )
        return rows[0]

    def delete_session(self, session_id):
        with self.conn:
            self.conn.execute("DELETE FROM round_log WHERE session_id = ?", (session_id,))
            self.conn.execute("DELETE FROM firm_round WHERE session_id = ?", (session_id,))
            self.conn.execute("DELETE FROM round_meta WHERE session_id = ?", (session_id,))
            self.conn.execute("DELETE FROM student WHERE session_id = ?", (session_id,))
            self.conn.execute("DELETE FROM firm WHERE session_id = ?", (session_id,))
            self.conn.execute("DELETE FROM session WHERE id = ?", (session_id,))

    # -- Student CRUD -------------------------------------------------------

    def join_student(self, session, faculty_id, display_name, params):
        """Register a student without persisting the faculty ID.

        The token is derived deterministically from the session's pseudonym
        key and the faculty ID (HMAC-SHA256). The faculty ID exists only in
        request memory for the duration of this call; nothing about it is
        written to the database. If the same faculty ID rejoins the same
        session, the same token comes back so their state is preserved.
        """
        faculty_id_norm = normalize_faculty_id(faculty_id)
        name_norm = normalize_display_name(display_name)
        token = derive_student_token(session["pseudonym_key"], faculty_id_norm)
        session_id = session["id"]
        existing = self.conn.execute(
            "SELECT * FROM student WHERE session_id = ? AND token = ?",
            (session_id, token),
        ).fetchone()
        if existing:
            # Update display name if different; keep token & state.
            if existing["display_name"] != name_norm:
                with self.conn:
                    self.conn.execute(
                        "UPDATE student SET display_name = ? WHERE id = ?",
                        (name_norm, existing["id"]),
                    )
            return self.conn.execute(
                "SELECT * FROM student WHERE id = ?", (existing["id"],)
            ).fetchone()
        g_i = None
        if params.get("heterogeneous_g"):
            spread = float(params.get("g_spread", 0.2))
            g_base = float(params.get("g", 1500))
            low, high = g_base * (1.0 - spread), g_base * (1.0 + spread)
            g_i = round(random.uniform(low, high), 2)
        status = "waiting"
        if session["phase"] in ("effort", "resolution", "ended"):
            status = "late"
        with self.conn:
            cur = self.conn.execute(
                """INSERT INTO student (session_id, token, display_name,
                    created_at, g_i, status)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (session_id, token, name_norm, utc_now(), g_i, status),
            )
        return self.conn.execute(
            "SELECT * FROM student WHERE id = ?", (cur.lastrowid,)
        ).fetchone()

    def tokenize_ids(self, session, faculty_ids):
        """Return {normalized_id: token} for a batch of IDs.

        This is the server-side reverse-lookup the instructor uses after
        class to map their local roster back to the anonymous tokens in
        the CSV. It does not require the student to have joined — any
        valid-looking faculty ID will produce the same token it would
        have received if they did join. Nothing is persisted.
        """
        out = {}
        for raw in faculty_ids or []:
            try:
                norm = normalize_faculty_id(raw)
            except ValueError:
                continue
            out[norm] = derive_student_token(session["pseudonym_key"], norm)
        return out

    def get_student_by_token(self, token):
        return self.conn.execute(
            "SELECT * FROM student WHERE token = ?", (token,)
        ).fetchone()

    def list_students(self, session_id):
        return self.conn.execute(
            "SELECT * FROM student WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()

    # -- Firm CRUD ----------------------------------------------------------

    def list_firms(self, session_id):
        return self.conn.execute(
            "SELECT * FROM firm WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()

    def available_firms_grouped(self, session_id):
        rows = self.conn.execute(
            """SELECT firm_type, firm_label, monitoring_label, contract_label,
                      current_wage, monitoring, contract_length,
                      COUNT(*) AS total, SUM(slots_filled) AS filled
               FROM firm WHERE session_id = ?
               GROUP BY firm_type""",
            (session_id,),
        ).fetchall()
        return rows

    # -- Round start --------------------------------------------------------

    def start_session(self, session_id):
        session = self.get_session(session_id)
        if session["phase"] != "lobby":
            raise ValueError("Session already started.")
        params = json.loads(session["params_json"])
        # Reset student states for round 1. (They should be fresh anyway.)
        with self.conn:
            self.conn.execute(
                """UPDATE student SET status = 'waiting',
                     firing_penalty_remaining = 0, current_firm_id = NULL,
                     current_wage = NULL, current_monitoring = NULL,
                     current_contract_length = NULL, current_firm_type = NULL,
                     current_firm_label = NULL, current_effort_choice = NULL,
                     current_caught = NULL, current_earnings = NULL
                   WHERE session_id = ?""",
                (session_id,),
            )
            # Reset firm slots
            self.conn.execute(
                "UPDATE firm SET slots_filled = 0 WHERE session_id = ?",
                (session_id,),
            )
        self._begin_auction(session_id, 1, params)

    def _begin_auction(self, session_id, round_number, params):
        ends = monotonic_now() + float(params.get("duration_auction", 25))
        with self.conn:
            self.conn.execute(
                """UPDATE session SET phase = 'auction', current_round = ?,
                     phase_ends_at = ?, phase_remaining = NULL, paused = 0
                   WHERE id = ?""",
                (round_number, ends, session_id),
            )
            # Students whose firing penalty is still > 0 sit out and are assigned
            # to 'sitting_out' immediately. Others go 'waiting'.
            self.conn.execute(
                """UPDATE student SET current_firm_id = NULL,
                     current_wage = NULL, current_monitoring = NULL,
                     current_contract_length = NULL, current_firm_type = NULL,
                     current_firm_label = NULL, current_effort_choice = NULL,
                     current_caught = NULL, current_earnings = NULL,
                     status = CASE WHEN firing_penalty_remaining > 0
                                   THEN 'sitting_out' ELSE 'waiting' END
                   WHERE session_id = ?""",
                (session_id,),
            )
            # For sitting-out students, pre-populate the round record fields so
            # they see the right phase immediately.
            self.conn.execute(
                """UPDATE student SET current_firm_type = 'sitting_out',
                     current_firm_label = 'Sitting out', current_wage = 0,
                     current_monitoring = 0, current_contract_length = 0
                   WHERE session_id = ? AND status = 'sitting_out'""",
                (session_id,),
            )
            # Reset firm slot counts
            self.conn.execute(
                "UPDATE firm SET slots_filled = 0 WHERE session_id = ?",
                (session_id,),
            )
        EVENT_BUS.publish(session_id, {"kind": "phase", "phase": "auction",
                                       "round": round_number})

    # -- Apply / backup -----------------------------------------------------

    def apply_to_firm_type(self, session_id, student_id, firm_type):
        session = self.get_session(session_id)
        if session["phase"] != "auction":
            raise ValueError("Applications are only accepted during the auction phase.")
        student = self.conn.execute(
            "SELECT * FROM student WHERE id = ?", (student_id,)
        ).fetchone()
        if not student:
            raise ValueError("Unknown student.")
        if student["status"] == "sitting_out":
            raise ValueError("You were fired last round and must take the backup job.")
        if student["status"] in ("employed", "backup"):
            raise ValueError("You have already chosen a job for this round.")
        # Find the first open slot of this firm type, claim it atomically.
        with self.conn:
            firm = self.conn.execute(
                """SELECT * FROM firm
                   WHERE session_id = ? AND firm_type = ? AND slots_filled < slots_total
                   ORDER BY id LIMIT 1""",
                (session_id, firm_type),
            ).fetchone()
            if firm is None:
                raise ValueError("All slots at that firm type are taken.")
            self.conn.execute(
                """UPDATE firm SET slots_filled = slots_filled + 1
                   WHERE id = ? AND slots_filled < slots_total""",
                (firm["id"],),
            )
            # Check the update actually applied (race guard).
            firm = self.conn.execute(
                "SELECT * FROM firm WHERE id = ?", (firm["id"],)
            ).fetchone()
            if firm["slots_filled"] > firm["slots_total"]:
                # Should not happen thanks to the WHERE clause, but guard anyway.
                raise ValueError("Slot was taken a moment ago.")
            self.conn.execute(
                """UPDATE student SET status = 'employed',
                     current_firm_id = ?, current_wage = ?, current_monitoring = ?,
                     current_contract_length = ?, current_firm_type = ?,
                     current_firm_label = ?
                   WHERE id = ?""",
                (firm["id"], firm["current_wage"], firm["monitoring"],
                 firm["contract_length"], firm["firm_type"], firm["firm_label"],
                 student_id),
            )
        return firm["id"]

    def take_backup(self, session_id, student_id):
        session = self.get_session(session_id)
        if session["phase"] != "auction":
            raise ValueError("Applications are only accepted during the auction phase.")
        student = self.conn.execute(
            "SELECT * FROM student WHERE id = ?", (student_id,)
        ).fetchone()
        if not student:
            raise ValueError("Unknown student.")
        if student["status"] == "sitting_out":
            return  # already sitting out; treat as no-op
        if student["status"] in ("employed", "backup"):
            raise ValueError("You have already chosen a job for this round.")
        params = json.loads(session["params_json"])
        with self.conn:
            self.conn.execute(
                """UPDATE student SET status = 'backup',
                     current_firm_id = NULL,
                     current_wage = ?, current_monitoring = 0,
                     current_contract_length = 0,
                     current_firm_type = 'backup',
                     current_firm_label = 'Backup job'
                   WHERE id = ?""",
                (float(params.get("w_outside", 1000)), student_id),
            )

    # -- Effort choice ------------------------------------------------------

    def set_effort(self, session_id, student_id, choice):
        if choice not in ("hard", "shirk"):
            raise ValueError("Effort choice must be 'hard' or 'shirk'.")
        session = self.get_session(session_id)
        if session["phase"] != "effort":
            raise ValueError("Effort choices are only accepted during the effort phase.")
        student = self.conn.execute(
            "SELECT * FROM student WHERE id = ?", (student_id,)
        ).fetchone()
        if not student:
            raise ValueError("Unknown student.")
        if student["status"] == "sitting_out":
            raise ValueError("You are sitting out this round.")
        if student["status"] not in ("employed", "backup"):
            raise ValueError("You are not scheduled to choose effort this round.")
        with self.conn:
            self.conn.execute(
                "UPDATE student SET current_effort_choice = ? WHERE id = ?",
                (choice, student_id),
            )

    # -- Phase transitions --------------------------------------------------

    def advance_phase(self, session_id):
        """Called by tick thread or instructor 'Advance' button."""
        session = self.get_session(session_id)
        phase = session["phase"]
        params = json.loads(session["params_json"])
        if phase == "lobby":
            self.start_session(session_id)
            return
        if phase == "auction":
            self._finalize_auction(session_id, params)
            return
        if phase == "effort":
            self._finalize_effort(session_id, params)
            return
        if phase == "resolution":
            self._finalize_resolution(session_id)
            return
        if phase == "ended":
            return
        raise ValueError(f"Unknown phase {phase}")

    def _finalize_auction(self, session_id, params):
        """All 'waiting' students -> backup. Transition to effort phase."""
        with self.conn:
            self.conn.execute(
                """UPDATE student SET status = 'backup',
                     current_firm_id = NULL, current_wage = ?,
                     current_monitoring = 0, current_contract_length = 0,
                     current_firm_type = 'backup',
                     current_firm_label = 'Backup job'
                   WHERE session_id = ? AND status = 'waiting'""",
                (float(params.get("w_outside", 1000)), session_id),
            )
            ends = monotonic_now() + float(params.get("duration_effort", 20))
            self.conn.execute(
                """UPDATE session SET phase = 'effort',
                     phase_ends_at = ?, phase_remaining = NULL
                   WHERE id = ?""",
                (ends, session_id),
            )
        EVENT_BUS.publish(session_id, {"kind": "phase", "phase": "effort"})

    def _finalize_effort(self, session_id, params):
        """Default missing choices -> 'hard'. Resolve outcomes, log, transition."""
        session = self.get_session(session_id)
        round_number = session["current_round"]
        g_default = float(params.get("g", 1500))
        c_effort = float(params.get("c_effort", 500))
        firing_rounds = int(params.get("firing_penalty_rounds", 1))
        now_iso = utc_now()
        # Fill in defaults.
        with self.conn:
            self.conn.execute(
                """UPDATE student SET current_effort_choice = 'hard'
                   WHERE session_id = ? AND status IN ('employed', 'backup')
                     AND current_effort_choice IS NULL""",
                (session_id,),
            )
        students = self.conn.execute(
            "SELECT * FROM student WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
        firm_stats = {}  # firm_id -> (n_hired, n_shirked, n_caught)
        total_employed = 0
        total_backup = 0
        total_sitting = 0
        total_shirk = 0
        wage_sum = 0.0
        wage_count = 0
        log_rows = []
        student_updates = []
        for st in students:
            g_i = st["g_i"] if st["g_i"] is not None else g_default
            status = st["status"]
            choice = st["current_effort_choice"]
            caught = None
            earnings = 0.0
            wage = float(st["current_wage"] or 0)
            monitoring = float(st["current_monitoring"] or 0)
            contract = int(st["current_contract_length"] or 0)
            firm_id = st["current_firm_id"]
            firm_type = st["current_firm_type"]
            firm_label = st["current_firm_label"]
            new_firing = int(st["firing_penalty_remaining"])
            if status == "employed":
                total_employed += 1
                wage_sum += wage
                wage_count += 1
                stats = firm_stats.setdefault(firm_id, [0, 0, 0])
                stats[0] += 1
                if choice == "shirk":
                    stats[1] += 1
                    total_shirk += 1
                    u = random.random()
                    if u < monitoring:
                        caught = 1
                        earnings = 0.0
                        new_firing = firing_rounds
                        stats[2] += 1
                    else:
                        caught = 0
                        earnings = wage + g_i
                else:
                    caught = 0
                    earnings = wage - c_effort
            elif status == "backup":
                total_backup += 1
                if choice == "shirk":
                    total_shirk += 1
                    earnings = wage + g_i  # backup is never monitored
                    caught = 0
                else:
                    earnings = wage - c_effort
                    caught = 0
            elif status == "sitting_out":
                total_sitting += 1
                earnings = 0.0
                caught = None
                # penalty decrement handled below after logging
            else:
                continue
            new_cumulative = float(st["cumulative_earnings"]) + earnings
            student_updates.append(
                (earnings, caught, new_cumulative, round_number, new_firing, st["id"])
            )
            log_rows.append(
                (
                    session_id, round_number, st["id"], firm_id, firm_type,
                    firm_label, wage, monitoring, contract, choice, caught,
                    earnings, new_cumulative, status, now_iso,
                )
            )
        # Decrement firing penalty for students who were sitting out this round.
        # They consumed a sit-out round, so penalty drops by 1.
        with self.conn:
            for earnings, caught, cum, rnd, new_firing, sid in student_updates:
                # For sitting_out students the new_firing value was not adjusted
                # above. Decrement there.
                self.conn.execute(
                    """UPDATE student SET current_earnings = ?, current_caught = ?,
                         cumulative_earnings = ?, last_round_completed = ?,
                         firing_penalty_remaining = CASE
                           WHEN status = 'sitting_out' AND firing_penalty_remaining > 0
                             THEN firing_penalty_remaining - 1
                           ELSE ?
                         END
                       WHERE id = ?""",
                    (earnings, caught, cum, rnd, new_firing, sid),
                )
            self.conn.executemany(
                """INSERT INTO round_log (session_id, round, student_id, firm_id,
                     firm_type, firm_label, wage, monitoring, contract_length,
                     effort_choice, caught, earnings, cumulative_earnings, status,
                     logged_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                log_rows,
            )
            # Record per-firm round stats.
            firm_round_rows = []
            firms = self.conn.execute(
                "SELECT * FROM firm WHERE session_id = ?", (session_id,)
            ).fetchall()
            for firm in firms:
                stats = firm_stats.get(firm["id"], [0, 0, 0])
                firm_round_rows.append(
                    (session_id, round_number, firm["id"], firm["firm_type"],
                     firm["current_wage"], firm["slots_total"],
                     stats[0], stats[1], stats[2])
                )
            self.conn.executemany(
                """INSERT INTO firm_round (session_id, round, firm_id, firm_type,
                     wage_posted, slots_total, n_hired, n_shirked, n_caught)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                firm_round_rows,
            )
            total_active = total_employed + total_backup + total_sitting
            avg_wage = (wage_sum / wage_count) if wage_count else 0.0
            shirk_rate = (total_shirk / max(total_employed + total_backup, 1))
            unemp_rate = ((total_backup + total_sitting) / max(total_active, 1))
            self.conn.execute(
                """INSERT OR REPLACE INTO round_meta (session_id, round, avg_wage,
                     shirk_rate, unemployment_rate, completed_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (session_id, round_number, avg_wage, shirk_rate,
                 unemp_rate, now_iso),
            )
            ends = monotonic_now() + float(params.get("duration_resolution", 15))
            self.conn.execute(
                """UPDATE session SET phase = 'resolution',
                     phase_ends_at = ?, phase_remaining = NULL
                   WHERE id = ?""",
                (ends, session_id),
            )
        EVENT_BUS.publish(session_id, {"kind": "phase", "phase": "resolution",
                                       "round": round_number})

    def _finalize_resolution(self, session_id):
        session = self.get_session(session_id)
        round_number = session["current_round"]
        current_params = self._active_params(session)
        next_params = self._next_params(session)
        t_rounds = int(next_params.get("t_rounds", 10))
        if round_number >= t_rounds:
            with self.conn:
                self.conn.execute(
                    """UPDATE session SET phase = 'ended', phase_ends_at = NULL,
                         phase_remaining = NULL, ended_at = ?
                       WHERE id = ?""",
                    (utc_now(), session_id),
                )
            EVENT_BUS.publish(session_id, {"kind": "phase", "phase": "ended"})
            return
        if self._firm_types_changed(current_params, next_params):
            self._replace_firms(session_id, next_params)
        else:
            self._recompute_firm_wages(session_id, next_params, round_number)
        with self.conn:
            self.conn.execute(
                """UPDATE session
                   SET params_json = ?, pending_params_json = NULL
                   WHERE id = ?""",
                (json_dumps(next_params), session_id),
            )
        self._begin_auction(session_id, round_number + 1, next_params)

    def _recompute_firm_wages(self, session_id, params, just_completed_round):
        alpha = float(params.get("alpha", 1.0))
        beta = float(params.get("beta", 0.3))
        w_max_mult = float(params.get("w_max_multiplier", 2.0))
        stats = self.conn.execute(
            """SELECT firm_id, n_hired, n_shirked FROM firm_round
               WHERE session_id = ? AND round = ?""",
            (session_id, just_completed_round),
        ).fetchall()
        stats_map = {row["firm_id"]: row for row in stats}
        firms = self.conn.execute(
            "SELECT * FROM firm WHERE session_id = ?", (session_id,)
        ).fetchall()
        updates = []
        for firm in firms:
            row = stats_map.get(firm["id"])
            if row and row["n_hired"] > 0:
                shirk_rate = row["n_shirked"] / row["n_hired"]
            else:
                shirk_rate = 0.0
            w_base = firm["base_wage"]
            w_max = w_base * w_max_mult
            w_new = w_base + alpha * shirk_rate * (w_max - w_base)
            w_new = max(w_base, w_new - beta * (1 - shirk_rate) * (w_new - w_base))
            updates.append((round(w_new), firm["id"]))
        with self.conn:
            self.conn.executemany(
                "UPDATE firm SET current_wage = ? WHERE id = ?",
                updates,
            )

    # -- Pause / resume / manual override -----------------------------------

    def pause(self, session_id):
        session = self.get_session(session_id)
        if session["paused"] or session["phase"] in ("lobby", "ended"):
            return
        ends = session["phase_ends_at"] or monotonic_now()
        remaining = max(0.0, ends - monotonic_now())
        with self.conn:
            self.conn.execute(
                """UPDATE session SET paused = 1, phase_ends_at = NULL,
                     phase_remaining = ? WHERE id = ?""",
                (remaining, session_id),
            )
        EVENT_BUS.publish(session_id, {"kind": "paused"})

    def resume(self, session_id):
        session = self.get_session(session_id)
        if not session["paused"]:
            return
        remaining = session["phase_remaining"] or 0
        ends = monotonic_now() + float(remaining)
        with self.conn:
            self.conn.execute(
                """UPDATE session SET paused = 0, phase_ends_at = ?,
                     phase_remaining = NULL WHERE id = ?""",
                (ends, session_id),
            )
        EVENT_BUS.publish(session_id, {"kind": "resumed"})

    def extend_phase(self, session_id, seconds):
        session = self.get_session(session_id)
        if session["phase"] in ("lobby", "ended"):
            return
        if session["paused"]:
            new_remaining = max(0.0, (session["phase_remaining"] or 0) + seconds)
            with self.conn:
                self.conn.execute(
                    "UPDATE session SET phase_remaining = ? WHERE id = ?",
                    (new_remaining, session_id),
                )
        else:
            new_ends = (session["phase_ends_at"] or monotonic_now()) + seconds
            with self.conn:
                self.conn.execute(
                    "UPDATE session SET phase_ends_at = ? WHERE id = ?",
                    (new_ends, session_id),
                )

    # -- Parameter tuning ---------------------------------------------------

    def update_params(self, session_id, patch):
        session = self.get_session(session_id)
        if session["phase"] == "ended":
            raise ValueError("Session has already ended.")
        active = self._active_params(session)
        pending = self._pending_params(session)
        if session["phase"] == "lobby":
            updated = merge_params(active, patch)
            validate_params(updated)
            with self.conn:
                self.conn.execute(
                    """UPDATE session
                       SET params_json = ?, pending_params_json = NULL
                       WHERE id = ?""",
                    (json_dumps(updated), session_id),
                )
            if self._firm_types_changed(active, updated):
                self._replace_firms(session_id, updated)
            return updated, False
        base = pending or active
        updated = merge_params(base, patch)
        validate_params(updated)
        with self.conn:
            self.conn.execute(
                "UPDATE session SET pending_params_json = ? WHERE id = ?",
                (json_dumps(updated), session_id),
            )
        return updated, True

    def broadcast(self, session_id, message):
        msg = (message or "").strip()
        with self.conn:
            self.conn.execute(
                "UPDATE session SET broadcast_msg = ?, broadcast_at = ? WHERE id = ?",
                (msg or None, utc_now() if msg else None, session_id),
            )
        EVENT_BUS.publish(session_id, {"kind": "broadcast", "message": msg})

    def set_reveal(self, session_id, on):
        with self.conn:
            self.conn.execute(
                "UPDATE session SET reveal_on = ? WHERE id = ?",
                (1 if on else 0, session_id),
            )

    # -- Snapshots ----------------------------------------------------------

    def student_snapshot(self, student):
        session = self.get_session(student["session_id"])
        params = json.loads(session["params_json"])
        firms = self.available_firms_grouped(student["session_id"])
        history = self.conn.execute(
            """SELECT round, firm_type, firm_label, wage, effort_choice, caught,
                      earnings, cumulative_earnings, status
               FROM round_log WHERE student_id = ? ORDER BY round""",
            (student["id"],),
        ).fetchall()
        rank = self._student_rank(student["session_id"], student["cumulative_earnings"])
        phase_seconds_left = compute_remaining(session)
        broadcast = {
            "message": session["broadcast_msg"],
            "at": session["broadcast_at"],
        }
        return {
            "session": session_public(session, params),
            "broadcast": broadcast,
            "backup_wage": float(params.get("w_outside", 1000)),
            "params": params if session["reveal_on"] else public_params(params),
            "student": {
                "id": student["id"],
                "token": student["token"],
                "display_name": student["display_name"],
                "cumulative_earnings": round(float(student["cumulative_earnings"]), 2),
                "status": student["status"],
                "firing_penalty_remaining": student["firing_penalty_remaining"],
                "rank": rank,
                "current": {
                    "firm_id": student["current_firm_id"],
                    "firm_type": student["current_firm_type"],
                    "firm_label": student["current_firm_label"],
                    "wage": student["current_wage"],
                    "monitoring_label": firm_monitoring_label(
                        student["current_firm_type"], params, student["current_monitoring"]),
                    "contract_label": firm_contract_label(
                        student["current_firm_type"], params, student["current_contract_length"]),
                    "effort_choice": student["current_effort_choice"],
                    "caught": student["current_caught"],
                    "earnings": student["current_earnings"],
                },
                "history": [dict(r) for r in history],
                "g_i": student["g_i"] if session["reveal_on"] else None,
            },
            "firms_available": [
                {
                    "firm_type": r["firm_type"],
                    "firm_label": r["firm_label"],
                    "monitoring_label": r["monitoring_label"],
                    "contract_label": r["contract_label"],
                    "wage": round(float(r["current_wage"]), 0),
                    "slots_remaining": int(r["total"]) - int(r["filled"] or 0),
                    "slots_total": int(r["total"]),
                }
                for r in firms
            ],
            "phase_seconds_left": phase_seconds_left,
        }

    def _student_rank(self, session_id, earnings):
        row = self.conn.execute(
            """SELECT COUNT(*) + 1 AS rank FROM student
               WHERE session_id = ? AND cumulative_earnings > ?""",
            (session_id, earnings),
        ).fetchone()
        return int(row["rank"])

    def dashboard_snapshot(self, session_id, admin=False):
        session = self.get_session(session_id)
        if not session:
            return None
        params = self._active_params(session)
        pending_params = self._pending_params(session) if admin else None
        firms = self.available_firms_grouped(session_id)
        students = self.list_students(session_id)
        # Round history for charts.
        meta = self.conn.execute(
            """SELECT round, avg_wage, shirk_rate, unemployment_rate
               FROM round_meta WHERE session_id = ? ORDER BY round""",
            (session_id,),
        ).fetchall()
        # Per-firm wage series
        wage_series = self.conn.execute(
            """SELECT round, firm_type, AVG(wage_posted) AS avg_wage
               FROM firm_round WHERE session_id = ? GROUP BY round, firm_type
               ORDER BY round""",
            (session_id,),
        ).fetchall()
        # Live phase distribution
        phase_counts = {
            "waiting": 0, "employed": 0, "backup": 0, "sitting_out": 0,
        }
        caught_this_round = 0
        shirk_this_round = 0
        leaderboard = sorted(
            ({"display_name": st["display_name"],
              "cumulative_earnings": round(float(st["cumulative_earnings"]), 2),
              "id": st["id"],
              "token": st["token"] if admin else None}
             for st in students),
            key=lambda x: -x["cumulative_earnings"],
        )[:10]
        for st in students:
            phase_counts[st["status"]] = phase_counts.get(st["status"], 0) + 1
            if st["current_caught"]:
                caught_this_round += 1
            if st["current_effort_choice"] == "shirk":
                shirk_this_round += 1
        applicants_per_firm = []
        for g in firms:
            applicants_per_firm.append({
                "firm_type": g["firm_type"],
                "firm_label": g["firm_label"],
                "filled": int(g["filled"] or 0),
                "total": int(g["total"]),
                "current_wage": round(float(g["current_wage"]), 0),
            })
        return {
            "session": session_public(session, params),
            "student_count": len(students),
            "phase_counts": phase_counts,
            "caught_this_round": caught_this_round,
            "shirk_this_round": shirk_this_round,
            "applicants_per_firm": applicants_per_firm,
            "wage_series": [
                {"round": r["round"], "firm_type": r["firm_type"],
                 "avg_wage": round(float(r["avg_wage"]), 2)}
                for r in wage_series
            ],
            "round_meta": [
                {"round": r["round"],
                 "avg_wage": round(float(r["avg_wage"] or 0), 2),
                 "shirk_rate": round(float(r["shirk_rate"] or 0), 4),
                 "unemployment_rate": round(float(r["unemployment_rate"] or 0), 4)}
                for r in meta
            ],
            "leaderboard": leaderboard,
            "phase_seconds_left": compute_remaining(session),
            "params": params if session["reveal_on"] or admin else public_params(params),
            "pending_params": pending_params if admin else None,
            "reveal_on": bool(session["reveal_on"]),
            "broadcast": {
                "message": session["broadcast_msg"],
                "at": session["broadcast_at"],
            },
        }

    def admin_snapshot(self, session_id):
        base = self.dashboard_snapshot(session_id, admin=True)
        if base is None:
            return None
        students = self.list_students(session_id)
        base["students"] = [
            {
                "id": st["id"],
                "token": st["token"],
                "display_name": st["display_name"],
                "status": st["status"],
                "cumulative_earnings": round(float(st["cumulative_earnings"]), 2),
                "firing_penalty_remaining": st["firing_penalty_remaining"],
                "current_firm_type": st["current_firm_type"],
                "current_firm_label": st["current_firm_label"],
                "current_wage": st["current_wage"],
                "current_effort_choice": st["current_effort_choice"],
                "current_caught": st["current_caught"],
                "current_earnings": st["current_earnings"],
                "last_round_completed": st["last_round_completed"],
                "g_i": st["g_i"],
            }
            for st in students
        ]
        firms = self.list_firms(session_id)
        base["firms_detail"] = [
            {
                "id": f["id"],
                "firm_type": f["firm_type"],
                "firm_label": f["firm_label"],
                "base_wage": f["base_wage"],
                "current_wage": f["current_wage"],
                "monitoring": f["monitoring"],
                "contract_length": f["contract_length"],
                "slots_total": f["slots_total"],
                "slots_filled": f["slots_filled"],
            }
            for f in firms
        ]
        return base

    # -- CSV export ---------------------------------------------------------

    def export_csv(self, session_id):
        rows = self.conn.execute(
            """SELECT s.token, s.display_name, r.round, r.firm_id, r.firm_type,
                      r.firm_label, r.wage, r.monitoring, r.contract_length,
                      r.effort_choice, r.caught, r.earnings, r.cumulative_earnings,
                      r.status, r.logged_at
               FROM round_log r JOIN student s ON r.student_id = s.id
               WHERE r.session_id = ?
               ORDER BY r.round, s.id""",
            (session_id,),
        ).fetchall()
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow([
            "token", "display_name", "round", "firm_id", "firm_type",
            "firm_label", "wage_posted", "monitoring", "contract_length",
            "effort_choice", "caught", "earnings", "cumulative_earnings",
            "status", "logged_at",
        ])
        for r in rows:
            writer.writerow([
                r["token"], r["display_name"], r["round"], r["firm_id"],
                r["firm_type"], r["firm_label"], r["wage"], r["monitoring"],
                r["contract_length"], r["effort_choice"],
                "" if r["caught"] is None else int(r["caught"]),
                r["earnings"], r["cumulative_earnings"],
                r["status"], r["logged_at"],
            ])
        return out.getvalue()


# ---------------------------------------------------------------------------
# Param utilities
# ---------------------------------------------------------------------------


def merge_params(base, patch):
    merged = json.loads(json.dumps(base))  # deep copy
    for key, value in (patch or {}).items():
        if key == "firm_types" and isinstance(value, list):
            merged["firm_types"] = value
        else:
            merged[key] = value
    return merged


def validate_params(params):
    required_numeric = [
        "t_rounds", "w_outside", "g", "c_effort", "firing_penalty_rounds",
        "duration_auction", "duration_effort", "duration_resolution",
    ]
    for key in required_numeric:
        value = params.get(key)
        if value is None or (isinstance(value, bool)):
            raise ValueError(f"Parameter '{key}' must be a number.")
        try:
            float(value)
        except (TypeError, ValueError):
            raise ValueError(f"Parameter '{key}' must be numeric.")
    for ft in params.get("firm_types", []):
        for k in ("key", "label", "count", "base_wage", "monitoring",
                  "contract_length", "monitoring_label", "contract_label"):
            if k not in ft:
                raise ValueError(f"Firm type is missing field '{k}'.")


def public_params(params):
    """Hide numeric g/p/N from students unless reveal is on."""
    masked_firms = []
    for ft in params.get("firm_types", []):
        masked_firms.append({
            "key": ft["key"],
            "label": ft["label"],
            "count": ft["count"],
            "monitoring_label": ft["monitoring_label"],
            "contract_label": ft["contract_label"],
        })
    return {
        "t_rounds": params.get("t_rounds"),
        "duration_auction": params.get("duration_auction"),
        "duration_effort": params.get("duration_effort"),
        "duration_resolution": params.get("duration_resolution"),
        "firm_types": masked_firms,
    }


def session_public(session, params):
    return {
        "id": session["id"],
        "code": session["code"],
        "phase": session["phase"],
        "paused": bool(session["paused"]),
        "current_round": session["current_round"],
        "t_rounds": params.get("t_rounds"),
        "reveal_on": bool(session["reveal_on"]),
        "ended_at": session["ended_at"],
    }


def compute_remaining(session):
    if session["paused"]:
        return float(session["phase_remaining"] or 0)
    if session["phase_ends_at"] is None:
        return None
    return max(0.0, float(session["phase_ends_at"]) - monotonic_now())


def firm_monitoring_label(firm_type, params, monitoring):
    if not firm_type or firm_type in ("backup", "sitting_out"):
        return None
    for ft in params.get("firm_types", []):
        if ft["key"] == firm_type:
            return ft["monitoring_label"]
    return None


def firm_contract_label(firm_type, params, contract_length):
    if not firm_type or firm_type in ("backup", "sitting_out"):
        return None
    for ft in params.get("firm_types", []):
        if ft["key"] == firm_type:
            return ft["contract_label"]
    return None


# ---------------------------------------------------------------------------
# Tick thread: auto-advance phases
# ---------------------------------------------------------------------------


class TickThread(threading.Thread):
    def __init__(self, db_path, stop_event):
        super().__init__(daemon=True, name="labor-tick")
        self.db_path = db_path
        self.stop_event = stop_event

    def run(self):
        conn = connect(self.db_path)
        engine = Engine(conn)
        while not self.stop_event.is_set():
            try:
                now = monotonic_now()
                rows = conn.execute(
                    """SELECT id, phase_ends_at FROM session
                       WHERE paused = 0 AND phase NOT IN ('lobby', 'ended')
                         AND phase_ends_at IS NOT NULL AND phase_ends_at <= ?""",
                    (now,),
                ).fetchall()
                for row in rows:
                    session_id = row["id"]
                    lock = SESSION_LOCKS.get(session_id)
                    if not lock.acquire(blocking=False):
                        continue
                    try:
                        engine.advance_phase(session_id)
                        EVENT_BUS.publish(session_id, {"kind": "tick"})
                    except Exception as exc:
                        print(f"[tick] error advancing session {session_id}: {exc}")
                    finally:
                        lock.release()
            except Exception as exc:
                print(f"[tick] outer error: {exc}")
            self.stop_event.wait(0.5)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "LaborAuction/1.0"

    # -- Framework helpers --------------------------------------------------

    def _send_json(self, status, payload, extra_headers=None):
        body = json_dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, status, body, content_type="text/plain; charset=utf-8",
                   extra_headers=None):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self._send_cors()
        self.end_headers()
        self.wfile.write(data)

    def _send_error(self, status, message):
        self._send_json(status, {"error": message})

    def _send_cors(self):
        origin = self.server.allowed_origin or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, X-Admin-Key")
        self.send_header("Vary", "Origin")

    def log_message(self, fmt, *args):
        return  # silence default access log; errors still print

    def _parse_path(self):
        parsed = urlparse(self.path)
        return parsed.path, parse_qs(parsed.query)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _check_admin(self):
        key = self.headers.get("X-Admin-Key", "").strip()
        expected = self.server.admin_key
        if not expected:
            return True  # admin key not configured => open mode (dev only)
        if not key:
            return False
        return hmac.compare_digest(key, expected)

    # -- Routing ------------------------------------------------------------

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        path, qs = self._parse_path()
        try:
            if path == "/api/health":
                return self._send_json(200, {"ok": True, "now": utc_now()})
            if path == "/api/admin/sessions":
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_list_sessions()
            m = re.match(r"^/api/session/([^/]+)$", path)
            if m:
                return self._handle_get_session(m.group(1), admin=self._check_admin())
            m = re.match(r"^/api/session/([^/]+)/events$", path)
            if m:
                return self._handle_events(m.group(1), qs)
            m = re.match(r"^/api/session/([^/]+)/dashboard$", path)
            if m:
                return self._handle_dashboard(m.group(1), admin=self._check_admin())
            m = re.match(r"^/api/session/([^/]+)/admin$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_admin(m.group(1))
            m = re.match(r"^/api/session/([^/]+)/csv$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_csv(m.group(1))
            m = re.match(r"^/api/student/([^/]+)/state$", path)
            if m:
                return self._handle_student_state(m.group(1))
            return self._send_error(404, "Not found.")
        except Exception as exc:
            return self._send_error(500, f"Server error: {exc}")

    def do_POST(self):
        path, _qs = self._parse_path()
        try:
            body = self._read_body()
            payload = parse_json(body)
            if path == "/api/session":
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_create_session(payload)
            if path == "/api/session/current/join":
                return self._handle_join_current(payload)
            m = re.match(r"^/api/session/([^/]+)/start$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_session_action(m.group(1), "start")
            m = re.match(r"^/api/session/([^/]+)/advance$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_session_action(m.group(1), "advance")
            m = re.match(r"^/api/session/([^/]+)/pause$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_session_action(m.group(1), "pause")
            m = re.match(r"^/api/session/([^/]+)/resume$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_session_action(m.group(1), "resume")
            m = re.match(r"^/api/session/([^/]+)/extend$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_extend(m.group(1), payload)
            m = re.match(r"^/api/session/([^/]+)/params$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_params(m.group(1), payload)
            m = re.match(r"^/api/session/([^/]+)/broadcast$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_broadcast(m.group(1), payload)
            m = re.match(r"^/api/session/([^/]+)/reveal$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_reveal(m.group(1), payload)
            m = re.match(r"^/api/session/([^/]+)/join$", path)
            if m:
                return self._handle_join(m.group(1), payload)
            m = re.match(r"^/api/session/([^/]+)/tokenize$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_tokenize(m.group(1), payload)
            m = re.match(r"^/api/student/([^/]+)/apply$", path)
            if m:
                return self._handle_apply(m.group(1), payload)
            m = re.match(r"^/api/student/([^/]+)/backup$", path)
            if m:
                return self._handle_backup(m.group(1))
            m = re.match(r"^/api/student/([^/]+)/effort$", path)
            if m:
                return self._handle_effort(m.group(1), payload)
            return self._send_error(404, "Not found.")
        except ValueError as exc:
            return self._send_error(400, str(exc))
        except Exception as exc:
            return self._send_error(500, f"Server error: {exc}")

    def do_DELETE(self):
        path, _qs = self._parse_path()
        try:
            m = re.match(r"^/api/session/([^/]+)$", path)
            if m:
                if not self._check_admin():
                    return self._send_error(401, "Admin key required.")
                return self._handle_delete_session(m.group(1))
            return self._send_error(404, "Not found.")
        except Exception as exc:
            return self._send_error(500, f"Server error: {exc}")

    # -- Handlers -----------------------------------------------------------

    def _engine(self):
        return Engine(self.server.get_conn())

    def _resolve_session(self, code):
        engine = self._engine()
        session = engine.get_session_by_code(code)
        if not session:
            raise ValueError("Session not found.")
        return engine, session

    def _handle_create_session(self, payload):
        engine = self._engine()
        session = engine.create_session(payload.get("params") or {})
        params = json.loads(session["params_json"])
        return self._send_json(201, {
            "session": session_public(session, params),
            "params": params,
        })

    def _handle_list_sessions(self):
        engine = self._engine()
        rows = engine.list_sessions()
        items = []
        for s in rows:
            params = json.loads(s["params_json"])
            items.append({
                "session": session_public(s, params),
                "created_at": s["created_at"],
            })
        return self._send_json(200, {"sessions": items})

    def _handle_delete_session(self, code):
        engine, session = self._resolve_session(code)
        engine.delete_session(session["id"])
        return self._send_json(200, {"ok": True})

    def _handle_get_session(self, code, admin=False):
        engine, session = self._resolve_session(code)
        params = json.loads(session["params_json"])
        return self._send_json(200, {
            "session": session_public(session, params),
            "params": params if (admin or session["reveal_on"]) else public_params(params),
        })

    def _handle_session_action(self, code, action):
        engine, session = self._resolve_session(code)
        lock = SESSION_LOCKS.get(session["id"])
        with lock:
            if action == "start":
                engine.start_session(session["id"])
            elif action == "advance":
                engine.advance_phase(session["id"])
            elif action == "pause":
                engine.pause(session["id"])
            elif action == "resume":
                engine.resume(session["id"])
        EVENT_BUS.publish(session["id"], {"kind": action})
        return self._send_json(200, {"ok": True, "action": action})

    def _handle_extend(self, code, payload):
        engine, session = self._resolve_session(code)
        try:
            seconds = float(payload.get("seconds", 0))
        except (TypeError, ValueError):
            raise ValueError("seconds must be numeric.")
        lock = SESSION_LOCKS.get(session["id"])
        with lock:
            engine.extend_phase(session["id"], seconds)
        EVENT_BUS.publish(session["id"], {"kind": "extend", "seconds": seconds})
        return self._send_json(200, {"ok": True})

    def _handle_params(self, code, payload):
        engine, session = self._resolve_session(code)
        patch = payload.get("params") or payload
        lock = SESSION_LOCKS.get(session["id"])
        with lock:
            params, staged = engine.update_params(session["id"], patch)
        EVENT_BUS.publish(session["id"], {"kind": "params"})
        return self._send_json(200, {"ok": True, "params": params, "staged": staged})

    def _handle_broadcast(self, code, payload):
        engine, session = self._resolve_session(code)
        message = payload.get("message", "")
        engine.broadcast(session["id"], message)
        return self._send_json(200, {"ok": True})

    def _handle_reveal(self, code, payload):
        engine, session = self._resolve_session(code)
        on = bool(payload.get("on"))
        engine.set_reveal(session["id"], on)
        EVENT_BUS.publish(session["id"], {"kind": "reveal", "on": on})
        return self._send_json(200, {"ok": True, "reveal_on": on})

    def _handle_join(self, code, payload):
        engine, session = self._resolve_session(code)
        params = json.loads(session["params_json"])
        faculty_id = payload.get("faculty_id", "")
        display_name = payload.get("display_name", "")
        lock = SESSION_LOCKS.get(session["id"])
        with lock:
            student = engine.join_student(session, faculty_id, display_name, params)
        EVENT_BUS.publish(session["id"], {"kind": "joined"})
        return self._send_json(200, {
            "token": student["token"],
            "student_id": student["id"],
            "display_name": student["display_name"],
            "session": session_public(session, params),
        })

    def _handle_join_current(self, payload):
        engine = self._engine()
        session = engine.get_current_session()
        params = json.loads(session["params_json"])
        faculty_id = payload.get("faculty_id", "")
        display_name = payload.get("display_name", "")
        lock = SESSION_LOCKS.get(session["id"])
        with lock:
            student = engine.join_student(session, faculty_id, display_name, params)
        EVENT_BUS.publish(session["id"], {"kind": "joined"})
        return self._send_json(200, {
            "token": student["token"],
            "student_id": student["id"],
            "display_name": student["display_name"],
            "session": session_public(session, params),
        })

    def _handle_tokenize(self, code, payload):
        engine, session = self._resolve_session(code)
        ids = payload.get("ids") or []
        if not isinstance(ids, list):
            raise ValueError("'ids' must be a list of faculty IDs.")
        mapping = engine.tokenize_ids(session, ids)
        return self._send_json(200, {"mapping": mapping})

    def _handle_student_state(self, token):
        engine = self._engine()
        student = engine.get_student_by_token(token)
        if not student:
            return self._send_error(404, "Unknown student token.")
        snapshot = engine.student_snapshot(student)
        return self._send_json(200, snapshot)

    def _handle_apply(self, token, payload):
        engine = self._engine()
        student = engine.get_student_by_token(token)
        if not student:
            raise ValueError("Unknown student token.")
        firm_type = payload.get("firm_type")
        if not firm_type:
            raise ValueError("firm_type is required.")
        lock = SESSION_LOCKS.get(student["session_id"])
        with lock:
            firm_id = engine.apply_to_firm_type(student["session_id"], student["id"], firm_type)
        EVENT_BUS.publish(student["session_id"], {"kind": "applied"})
        return self._send_json(200, {"ok": True, "firm_id": firm_id})

    def _handle_backup(self, token):
        engine = self._engine()
        student = engine.get_student_by_token(token)
        if not student:
            raise ValueError("Unknown student token.")
        lock = SESSION_LOCKS.get(student["session_id"])
        with lock:
            engine.take_backup(student["session_id"], student["id"])
        EVENT_BUS.publish(student["session_id"], {"kind": "applied"})
        return self._send_json(200, {"ok": True})

    def _handle_effort(self, token, payload):
        engine = self._engine()
        student = engine.get_student_by_token(token)
        if not student:
            raise ValueError("Unknown student token.")
        choice = payload.get("choice")
        lock = SESSION_LOCKS.get(student["session_id"])
        with lock:
            engine.set_effort(student["session_id"], student["id"], choice)
        EVENT_BUS.publish(student["session_id"], {"kind": "effort"})
        return self._send_json(200, {"ok": True})

    def _handle_dashboard(self, code, admin=False):
        engine, session = self._resolve_session(code)
        snap = engine.dashboard_snapshot(session["id"], admin=admin)
        return self._send_json(200, snap)

    def _handle_admin(self, code):
        engine, session = self._resolve_session(code)
        snap = engine.admin_snapshot(session["id"])
        return self._send_json(200, snap)

    def _handle_csv(self, code):
        engine, session = self._resolve_session(code)
        body = engine.export_csv(session["id"])
        filename = f"labor-session-{session['code']}.csv"
        return self._send_text(
            200, body,
            content_type="text/csv; charset=utf-8",
            extra_headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # -- SSE ---------------------------------------------------------------

    def _handle_events(self, code, qs):
        engine, session = self._resolve_session(code)
        session_id = session["id"]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self._send_cors()
        self.end_headers()
        q = EVENT_BUS.subscribe(session_id)
        try:
            # Send an initial ping and prime the client.
            self._sse_send({"kind": "hello", "now": utc_now()})
            last_snapshot = 0.0
            while True:
                timeout = 1.0
                try:
                    data = q.get(timeout=timeout)
                    self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    pass
                # Regardless: send a periodic "tick" every 1s so clients can
                # refresh their timers / progress bars without their own poll.
                now = monotonic_now()
                if now - last_snapshot >= 1.0:
                    self._sse_send({"kind": "tick", "now": utc_now()})
                    last_snapshot = now
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            return
        finally:
            EVENT_BUS.unsubscribe(session_id, q)

    def _sse_send(self, payload):
        data = json_dumps(payload)
        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
        self.wfile.flush()


# ---------------------------------------------------------------------------
# Server wrapper
# ---------------------------------------------------------------------------


class LaborServer(ThreadingHTTPServer):
    def __init__(self, address, handler, db_path, admin_key, allowed_origin):
        super().__init__(address, handler)
        self.db_path = db_path
        self.admin_key = admin_key
        self.allowed_origin = allowed_origin
        self._conn_lock = threading.Lock()
        self._thread_conns = {}

    def get_conn(self):
        ident = threading.get_ident()
        with self._conn_lock:
            conn = self._thread_conns.get(ident)
            if conn is None:
                conn = connect(self.db_path)
                self._thread_conns[ident] = conn
            return conn


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--db", default=None)
    args = parser.parse_args()

    db_path = args.db or os.environ.get(
        "LABOR_DB_PATH",
        str(Path(__file__).parent / "data" / "labor.db"),
    )
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    admin_key = os.environ.get("LABOR_ADMIN_KEY", "").strip()
    allowed_origin = os.environ.get("LABOR_ALLOWED_ORIGIN", "").strip() or None

    # Prime the schema on the main thread.
    init_schema(connect(db_path))

    stop_event = threading.Event()
    tick = TickThread(db_path, stop_event)
    tick.start()

    server = LaborServer((args.host, args.port), Handler, db_path, admin_key, allowed_origin)
    print(f"[labor] listening on {args.host}:{args.port}")
    print(f"[labor] db: {db_path}")
    if admin_key:
        print("[labor] admin key is set (X-Admin-Key header required for admin routes)")
    else:
        print("[labor] WARNING: no admin key set (dev mode, all admin routes open)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[labor] shutting down")
    finally:
        stop_event.set()
        server.server_close()


if __name__ == "__main__":
    main()
