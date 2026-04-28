# Session Quiz — Build Spec

## 1. Purpose

A browser-based classroom MCQ quiz dashboard, resilient to LLM-assisted
cheating via a **blur-swap rule**: when a student switches tabs or apps, the
current question is replaced with a fresh one from the bank. Students take
the quiz on their phones; the instructor configures every session parameter
from a console and exports results to Excel.

Reuses the architecture of the `labor-auction-sim` and `matching-dashboard`
projects: Python 3 stdlib HTTP server, SQLite, vanilla JS frontend, shared
CSS, no build step. Two small external deps: `openpyxl` (Excel I/O),
`qrcode` (join-code QR).

---

## 2. Roles

- **Instructor** — one per session. Creates sessions, uploads/manages
  question banks, monitors live, exports results.
- **Student** — up to ~100 per session. Joins via student number, takes quiz
  on phone.

---

## 3. Session lifecycle

1. **Setup** — Instructor picks a bank, sets parameters (§4), clicks
   *Create* → system returns a 6-char join code and a QR image.
2. **Lobby** — Students scan QR, enter student number. Backend derives
   HMAC student token (same scheme as `labor-auction-sim`), records join.
   Students see "Ready — waiting for instructor."
3. **Live** — Instructor clicks *Start*. `started_at` is the shared
   wall-clock anchor. Each student moves through items at own pace. A
   student's session ends when: item_count reached, wall-clock expired,
   bank exhausted, hard-blur (if configured), or instructor closed.
4. **Closed** — Scores finalised. Excel export available.

---

## 4. Instructor-configurable options

Set at session creation, stored in `quiz_session`.

| Option | Type | Default | Range / Values |
|---|---|---|---|
| `bank_id` | select | required | any uploaded bank |
| `lecture_tag` | select | required | tags present in the chosen bank |
| `display_name` | string | = lecture_tag | shown to students at login |
| `item_count` | int | 30 | 5–100 |
| `duration_minutes` | int | 60 | 5–180 |
| `swap_policy` | enum | `soft` | `soft` (blur swaps item, no penalty) / `hard` (blur ends session) |
| `permutation` | enum | `per_view` | `per_view` / `per_student` |
| `feedback` | enum | `immediate` | `immediate` / `end_of_session` |
| `exhaustion_policy` | enum | `end_session` | `end_session` / `recycle` |

The student login card renders a plain-Bulgarian rules statement derived
from these settings (e.g. "30 въпроса, 60 минути. Напускането на страницата
сменя въпроса.").

---

## 5. Anti-cheat mechanics

Two core rules. Everything else is out of scope.

**5.1 Blur swap.** Client binds `visibilitychange` (→`hidden`) and window
`blur` → POST `/quiz/blur` with current `attempt_id`. Server marks the
current attempt `swapped=1`, does **not** count it toward `item_count`, and
serves a fresh item on the next `/quiz/next` call. If `swap_policy=hard`,
the server instead ends the student's session with `end_reason='blur_hard'`.

**5.2 Per-view option permutation.** Every time an item is served
(including re-serves after a blur swap), options are shuffled with a fresh
seed. The server records `option_order_json` per attempt and maps the
student's `chosen_visible_index` back to the canonical bank index at
grading time.

Also: `copy`, `cut`, `contextmenu` on the item card → `preventDefault()`.
Friction only; not relied on.

**Explicitly not in v1:** keystroke telemetry, watermarks, duplicate-answer
detection, proctoring, webcam.

---

## 6. Data model (SQLite)

```sql
CREATE TABLE bank (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  uploaded_at INTEGER,
  source_filename TEXT
);

CREATE TABLE bank_item (
  id TEXT PRIMARY KEY,
  bank_id TEXT REFERENCES bank(id),
  lecture_tag TEXT NOT NULL,
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL,       -- canonical order, e.g. ["A","B","C","D"]
  correct_index INTEGER NOT NULL,   -- 0-based into options_json
  explanation TEXT
);

CREATE TABLE quiz_session (
  id TEXT PRIMARY KEY,
  join_code TEXT UNIQUE,
  bank_id TEXT,
  lecture_tag TEXT,
  display_name TEXT,
  item_count INTEGER,
  duration_minutes INTEGER,
  swap_policy TEXT,
  permutation TEXT,
  feedback TEXT,
  exhaustion_policy TEXT,
  created_at INTEGER,
  started_at INTEGER,
  closed_at INTEGER,
  status TEXT CHECK(status IN ('setup','lobby','live','closed'))
);

CREATE TABLE quiz_student (
  session_id TEXT,
  student_token TEXT,
  student_number TEXT,
  joined_at INTEGER,
  ended_at INTEGER,
  end_reason TEXT,          -- 'completed','time_up','exhausted','blur_hard','instructor_closed'
  PRIMARY KEY (session_id, student_token)
);

CREATE TABLE quiz_attempt (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  student_token TEXT,
  bank_item_id TEXT,
  ord INTEGER,              -- 1..item_count for counted items; NULL if swapped
  option_order_json TEXT,   -- permutation shown this view, e.g. [2,0,3,1]
  chosen_index INTEGER,     -- canonical bank index; NULL if swapped/unanswered
  correct INTEGER,          -- 1/0/NULL
  served_at INTEGER,
  submitted_at INTEGER,
  swapped INTEGER DEFAULT 0
);
```

Derived counts (`blur_count`, `items_correct`, `score_pct`) are computed at
export time from `quiz_attempt`, not stored.

---

## 7. API surface

JSON in/out. Admin endpoints require HMAC header (same scheme as the
existing dashboards).

**Student:**

```
POST /quiz/join
   {code, student_number}
   → {student_token, session_id, status, rules_text}

GET  /quiz/next?student_token=…
   → {attempt_id, stem, options:[...], ord, item_count, remaining_ms}
   | {session_ended:true, reason, score:{answered, correct}}

POST /quiz/answer
   {attempt_id, chosen_visible_index}
   → {correct, explanation?}     # explanation only if feedback=immediate

POST /quiz/blur
   {attempt_id}
   → {swapped:true} | {session_ended:true, reason:'blur_hard'}
```

**Instructor (HMAC):**

```
POST /quiz/admin/bank/upload            multipart .xlsx
   → {bank_id, item_count, tags:[...], warnings?:[...]}

GET  /quiz/admin/bank/list
   → [{bank_id, name, uploaded_at, item_count, tags}]

POST /quiz/admin/session/create
   {bank_id, lecture_tag, display_name, item_count, duration_minutes,
    swap_policy, permutation, feedback, exhaustion_policy}
   → {session_id, join_code, qr_png_url}

POST /quiz/admin/session/start          {session_id} → {started_at}
POST /quiz/admin/session/close          {session_id} → {closed_at}

GET  /quiz/admin/session/live?session_id=…
   → {status, elapsed_ms, remaining_ms,
      students:[{student_number, answered, swapped, current_ord, ended}]}

GET  /quiz/admin/session/export?session_id=…
   → .xlsx binary (filename: quiz_<code>_<YYYYMMDD>.xlsx)
```

No SSE. Student client polls `/quiz/live_status` only if needed for lobby
→ live transition (simple 3s poll).

---

## 8. Question bank — Excel format

Instructor authors questions in Excel and uploads via
`/quiz/admin/bank/upload`. One sheet named `items`, one row per question:

| Column | Required | Notes |
|---|---|---|
| `lecture_tag` | yes | grouping tag, e.g. `ch06_moral_hazard` |
| `stem` | yes | question text (Unicode Bulgarian OK) |
| `option_a` | yes | first option |
| `option_b` | yes | second option |
| `option_c` | no | filled = shown; blank = ignored |
| `option_d` | no | " |
| `option_e` | no | " |
| `option_f` | no | " |
| `correct` | yes | letter: `a`/`b`/`c`/… matching a filled option |
| `explanation` | no | one-line feedback shown after answer if `feedback=immediate` |

**Upload handler** validates every row (≥2 options, `correct` letter maps
to a filled option, `stem` non-empty), then inserts in a single
transaction. Row-level errors are returned in `warnings` and the bank is
rejected if any error is fatal. Each upload creates a **new** `bank_id`;
editing = re-upload as new version.

The archived `.xlsx` is stored under `backend/banks/<bank_id>.xlsx` for
reproducibility.

---

## 9. Excel export

`.xlsx` with two sheets.

**Sheet `summary`** — one row per student:

```
student_number, joined_at, ended_at, end_reason,
items_answered, items_correct, score_pct, blur_count
```

**Sheet `detail`** — one row per attempt (including swapped):

```
student_number, ord, bank_item_id, lecture_tag, stem,
chosen_option_text, correct_option_text, correct, swapped,
served_at, submitted_at, response_ms
```

Timestamps formatted as Excel-native datetime, not epoch. `score_pct` as a
number (0–100), not a string.

---

## 10. Student UI

Single page, phone-first, same CSS palette as the other dashboards
(`--accent: #0d6a6e`, serif headings, `.shell` max-width).

Cards (only one visible at a time):

- **Login** — session display_name, student_number input, rules text,
  *Join* button.
- **Lobby** — "Ready — waiting for instructor." Poll every 3s.
- **Quiz** — header (`Въпрос X от N` + mm:ss remaining), stem, options as
  large tap targets (radio semantics, single select), *Submit* button
  disabled until selection. After submit with `feedback=immediate`: a
  green/red chip + the one-line explanation, then *Next* button → next
  `/quiz/next`. With `feedback=end_of_session`: auto-advance.
- **End** — "Готово. N от M верни отговора." No per-item review.

Client event bindings on the quiz card:

- `document.visibilitychange` when `document.hidden === true` → POST
  `/quiz/blur`.
- `window.blur` → POST `/quiz/blur`.
- `copy`, `cut`, `contextmenu` → `preventDefault()`.

No offline state. Reload re-fetches from server and continues from the
server-authoritative state.

All student-facing text in Bulgarian.

---

## 11. Instructor console

Single page, desktop-first, HMAC-gated. Two tabs.

**Banks tab**
- Table of uploaded banks: name, uploaded_at, item_count, tags.
- *Upload new* — file picker for `.xlsx`; preview row count and tags
  before commit; show any row warnings.

**Sessions tab**
- *Create session* form — all §4 options with defaults pre-filled.
  *Create* → big join code + QR for projection.
- *Live* panel (visible when a session is `live`) — table of joined
  students with answered count, current ord, swap count, ended? Poll
  every 3s. *Start* / *Close* buttons.
- *Past sessions* list with *Export .xlsx* button per row.

---

## 12. File layout & deployment

```
session-quiz/
  backend/
    server.py
    db.py
    bank_io.py            # openpyxl-based read/write
    qr.py                 # qrcode wrapper
    data/quiz.db
    banks/<bank_id>.xlsx  # archived uploads
  frontend/
    index.html            # student
    admin.html            # instructor
    app.js
    admin.js
    styles.css            # copy of shared palette
```

- Port: **8789** (8787/8788 reserved for existing dashboards).
- Env vars: `ADMIN_KEY`, `HMAC_SALT`, `DB_PATH`, `ALLOWED_ORIGIN`.
- Runs under the same Cloudflare Tunnel as the other two.
- `requirements.txt`: `openpyxl`, `qrcode[pil]`.

---

## 13. Build order

1. **Scaffold** — copy `labor-auction-sim/backend/server.py`, strip game
   logic, keep HMAC/CORS/routing. Apply schema from §6.
2. **bank_io.py** — `read_xlsx(path) → (items, warnings)` and unit test
   with a 5-row sample bank. Reject fatal rows.
3. **Session create + student join** — instructor creates with defaults,
   student joins, gets a stub `next` response. End-to-end smoke test.
4. **Quiz loop** — real `/next` and `/answer` with per-view permutation
   and immediate feedback. Correct mapping from visible index to
   canonical index.
5. **Blur swap** — client handlers + `/blur` endpoint. Verify `ord` is
   not incremented for swapped attempts.
6. **End conditions** — item_count, time_up, exhausted, blur_hard,
   instructor_closed. Each sets `end_reason` correctly.
7. **Instructor console** — banks tab, create form, live view, past
   sessions.
8. **Excel export** — two-sheet writer via openpyxl; test on a completed
   session of 10+ students.
9. **Polish** — rules text, QR render, mobile CSS pass, error states on
   reload.

---

## 14. Out of scope for v1

Free text, numeric items, rubrics, TA roles, peer ranking, chart
interpretation, links to other dashboards, LTI/Moodle, retake, keystroke
telemetry, watermarks, live proctoring, LaTeX rendering, question
generation at runtime.
