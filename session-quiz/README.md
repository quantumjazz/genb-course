# Session Quiz

A browser-based classroom MCQ quiz dashboard, resilient to LLM-assisted
cheating via a **blur-swap rule**: when a student switches tabs or apps,
the current question is replaced with a fresh one from the bank. Students
take the quiz on their phones; the instructor configures every session
parameter from a console and exports results to Excel. The full design is
in [`session-quiz-spec.md`](./session-quiz-spec.md).

Mirrors the architecture of the sibling `labor-auction-sim` and
`matching-dashboard` projects: stdlib HTTP server, SQLite, vanilla JS
frontend, no build step. Two external deps: `openpyxl` (Excel I/O) and
`qrcode[pil]` (join-code QR).

## Pages

| Page | For | What it does |
|------|-----|--------------|
| `index.html` | Students | Enter join code + student number, take the quiz. Bulgarian UI. |
| `admin.html` | Instructor | Upload question banks, create sessions, monitor live, export Excel. |

## Anti-cheat: blur swap

The quiz card binds `visibilitychange`, `window.blur`, and `pagehide` to
a `/quiz/blur` invalidation. The client records a local lost-focus marker,
uses `navigator.sendBeacon()` where possible, and forces a server refresh
when focus returns before allowing another answer. The server marks the
in-flight attempt `swapped=1`, **does not** count it toward `item_count`,
and serves a fresh item on the next `/quiz/next` call. With
`swap_policy=hard`, the server instead ends that student's session with
`end_reason='blur_hard'`.
In soft mode, swapped questions are still treated as seen for that
student, so they reduce the remaining unique pool and prevent question
shopping.

Per-view option permutation: every time an item is served (including
re-serves after a blur swap) the options are shuffled with a fresh seed.
The server records `option_order_json` and maps the student's
`chosen_visible_index` back to the canonical bank index at grading time.

`copy`/`cut`/`contextmenu` on the quiz card are `preventDefault()`'d.
Friction only; not relied on.

With `security_mode=strict`, students must enter browser fullscreen before
the first live question. Fullscreen exit, blur/visibility/pagehide, and a
suspicious fullscreen resize are logged as incidents and invalidate the
current attempt through the same blur-swap path.

## Run the backend

```bash
cd backend
python3 -m pip install -r requirements.txt

QUIZ_ADMIN_KEY=change-me \
python3 server.py --host 0.0.0.0 --port 8789
```

When the backend is started from `backend/`, it auto-discovers the
sibling `frontend/` directory and serves it as static files at the same
origin. Open `http://localhost:8789/` for the student page and
`http://localhost:8789/admin` for the instructor console.

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `QUIZ_ADMIN_KEY` | _empty_ | Required for admin endpoints. Empty = dev/open mode. |
| `QUIZ_ALLOWED_ORIGIN` | _empty (allow any)_ | CORS origin if the frontend lives on a different host. |
| `QUIZ_DB_PATH` | `backend/data/quiz.db` | SQLite path. |
| `QUIZ_PUBLIC_URL` | _empty_ | Base URL embedded into QR codes (e.g. `https://quiz.example.com`). |
| `QUIZ_FRONTEND_DIR` | auto-detect `../frontend` | Directory of static files to serve. |

To reset a local database:

```bash
rm backend/data/quiz.db backend/data/quiz.db-wal backend/data/quiz.db-shm
rm backend/banks/*.xlsx
```

## Question-bank Excel format

Sheet name **`items`**. Header on row 1.

| Column | Required | Notes |
|---|---|---|
| `lecture_tag` | yes | Grouping tag, e.g. `ch06_moral_hazard`. |
| `stem` | yes | Question text (Unicode Bulgarian OK). |
| `option_a`, `option_b` | yes | First two options. |
| `option_c` … `option_f` | no | Filled = shown; blank = ignored. |
| `correct` | yes | Letter (`a`/`b`/…) matching a filled option. |
| `explanation` | no | One-line feedback shown after answer if `feedback=immediate`. |

Each upload creates a **new** `bank_id`; editing = re-upload as new
version. The original `.xlsx` is archived under `backend/banks/<bank_id>.xlsx`.

## Excel export

Three sheets per session:

- **`summary`** — `student_number, joined_at, ended_at, end_reason,
  items_answered, items_correct, score_pct, blur_count, incident_count`.
- **`detail`** — one row per attempt (including swapped):
  `student_number, ord, bank_item_id, lecture_tag, stem,
  chosen_option_text, correct_option_text, correct, swapped, served_at,
  submitted_at, response_ms`.
- **`incidents`** — trust events logged by strict mode:
  `student_number, event_type, attempt_id, client_ts, server_ts, metadata_json`.

Timestamps as Excel-native datetimes; `score_pct` as a number.

## API surface

Student (no key):

- `POST /quiz/join` — `{code, student_number}` → `{student_token, …, rules_text}`.
- `GET /quiz/next?student_token=…` — `{attempt_id, stem, options[], ord, item_count, remaining_ms}` or `{session_ended:true, reason, score}`.
- `POST /quiz/answer` — `{attempt_id, chosen_visible_index}` → `{correct, explanation?, correct_option_text?, correct_visible_index?}` or `{session_ended:true, reason, score}`.
- `POST /quiz/blur` — `{attempt_id}` → `{swapped:true}` or `{session_ended:true, reason:"blur_hard"}`.
- `POST /quiz/incident` — `{student_token, attempt_id?, event_type, client_ts?, metadata?}` → `{ok:true}`.
- `GET /quiz/live_status?student_token=…` — `{status, ended, end_reason, remaining_ms?}` (lobby→live polling).

Instructor (HMAC `X-Admin-Key` or `X-Admin-Key-B64`):

- `POST /quiz/admin/bank/upload` — multipart `.xlsx` → `{bank_id, item_count, tags, warnings?}`.
- `GET /quiz/admin/bank/list` — list banks with tag counts.
- `DELETE /quiz/admin/bank/{bank_id}` — remove a bank (rejects if used by any session).
- `POST /quiz/admin/session/create` — all options from spec §4, including `lecture_tags` multi-select → `{session_id, join_code, qr_png_url, …}`.
- `POST /quiz/admin/session/start` / `close` — toggle session lifecycle.
- `GET /quiz/admin/session/list` — past + live sessions.
- `GET /quiz/admin/session/live?session_id=…` — `{session, elapsed_ms, remaining_ms, students[]}` (3s poll).
- `GET /quiz/admin/session/qr?session_id=…` — PNG of join URL.
- `GET /quiz/admin/session/export?session_id=…` — `.xlsx` binary.
- `DELETE /quiz/admin/session/{session_id}` — drop session and its attempts.

## Privacy: how `student_token` is derived

At session creation the server generates a random 32-byte `pseudonym_key`
and stores it on the `quiz_session` row (never exposed by any API). When
a student joins, the server computes:

```
token = base32(HMAC-SHA256(pseudonym_key, upper(student_number)))[:12]
```

The student number itself is also stored on `quiz_student.student_number`
so that the Excel export is meaningful — but this is an explicit choice
for the classroom-quiz use case, where the instructor needs to grade.
The `pseudonym_key` is only used for stable token derivation across
re-joins from the same student.

## Smoke test

`backend/smoke_test.py` exercises the full flow against a running
backend: upload bank → create session → start → join → answer → blur →
re-fetch → export. Useful when iterating on the server.

```bash
cd backend
python3 server.py --port 8789 &
python3 smoke_test.py --base http://localhost:8789
```

## Deployment

The backend runs on the same Ubuntu LTS host as `labor.visiometrica.com`
and `matching.visiometrica.com`, behind the same Cloudflare Tunnel.
Port **8789** is reserved for this service. Concrete deployment
instructions are kept out of this README until I've matched them
exactly to the host's existing pattern — see the project chat for the
runbook.
