# Session Quiz

A browser-based classroom MCQ quiz dashboard with a **blur-swap rule**:
when the browser reports that a student switches tabs or apps,
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
| `index.html` | Students | Enter session code + student number + private access code, take the quiz. Bulgarian UI. |
| `admin.html` | Instructor | Upload question banks, create sessions, issue private access codes, monitor live, export Excel. |

## Focus-change handling: blur swap

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
configured fullscreen resize are logged as technical events and invalidate the
current attempt through the same blur-swap path.

Focus/fullscreen events are technical signals, **not proof of cheating**.
Notifications, accessibility software, operating-system UI and browser behavior
can trigger them. Review any grade-affecting incident manually, let the student
explain, and provide an appropriate alternative when fullscreen is unavailable.

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
| `QUIZ_ADMIN_KEY` | _empty_ | Mandatory shared admin secret. Startup refuses an empty key; there is no open mode. |
| `QUIZ_ALLOWED_ORIGIN` | _empty (allow any)_ | CORS origin if the frontend lives on a different host. |
| `QUIZ_DB_PATH` | `backend/data/quiz.db` | SQLite path. Leave unset for the default; blank values are treated as unset and in-memory SQLite is refused. |
| `QUIZ_PUBLIC_URL` | _empty_ | Base URL embedded into QR codes (e.g. `https://quiz.example.com`). |
| `QUIZ_FRONTEND_DIR` | auto-detect `../frontend` | Directory of static files to serve. |
| `QUIZ_PRIVACY_NOTICE_URL` | _empty_ | HTTP/HTTPS URL of the full institutional privacy notice. Empty leaves an instructor warning; the app's short data explanation is not a complete notice. Use HTTPS in production. |

The instructor key stays in the page's memory only. Reloading requires entering
it again; **Lock** clears the key and sensitive views. Old browser-stored admin
keys are removed on page load. The non-secret selected session ID uses
`sessionStorage`. Student browser credentials use tab-scoped session storage;
the server stores only their hashes. Never put credentials in URLs, screenshots,
shared messages, source control, or proxy request logs.

To reset a local database:

```bash
rm backend/data/quiz.db backend/data/quiz.db-wal backend/data/quiz.db-shm
rm backend/banks/*.xlsx
```

On a hosted machine, the server prints the exact resolved database path at
startup (`[quiz] db: ...`). If an update appears to show an empty instructor
console, check that path first; the old `quiz.db`, `quiz.db-wal`,
`quiz.db-shm`, and `backend/banks/*.xlsx` files should remain at the path the
server is actually using.

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

Public configuration and student login:

- `GET /quiz/config` — `{privacy_notice_url}` (empty if not configured).
- `POST /quiz/join` — `{code, student_number, access_code}` → `{student_token, …, rules_text}`. The number must have an instructor-issued code for that session. Logging in issues a fresh random bearer token and invalidates an earlier login for that student.

Authenticated student requests use **`X-Student-Token: <student_token>`**.
For `sendBeacon`, which cannot set this header, include `student_token` in the
JSON body instead. POST handlers also accept that body field. GET tokens in
query strings and attempt IDs alone no longer authorize a request.

- `GET /quiz/next` — `{attempt_id, stem, options[], ord, item_count, remaining_ms}` or `{session_ended:true, reason, score}`.
- `POST /quiz/answer` — `{student_token?, attempt_id, chosen_visible_index}` → `{correct, explanation?, correct_option_text?, correct_visible_index?}` or `{session_ended:true, reason, score}`.
- `POST /quiz/blur` — `{student_token?, attempt_id}` → `{swapped:true}` or `{session_ended:true, reason:"blur_hard"}`.
- `POST /quiz/incident` — `{student_token, attempt_id?, event_type, client_ts?, metadata?}` → `{ok:true}`.
- `GET /quiz/live_status` — `{status, ended, end_reason, remaining_ms?}` (lobby→live polling).

Instructor (shared secret in `X-Admin-Key`, or UTF-8 base64 in `X-Admin-Key-B64`;
base64 is transport encoding, not encryption):

- `POST /quiz/admin/bank/upload` — multipart `.xlsx` → `{bank_id, item_count, tags, warnings?}`.
- `GET /quiz/admin/bank/list` — list banks with tag counts.
- `DELETE /quiz/admin/bank/{bank_id}` — remove a bank (rejects if used by any session).
- `POST /quiz/admin/session/create` — all options from spec §4, including `lecture_tags` multi-select → `{session_id, join_code, qr_png_url, …}`.
- `POST /quiz/admin/session/access-codes` — `{session_id, student_numbers:[...], replace:false}` → `{credentials:[{student_number,access_code}], skipped:[student_number,...]}`. Existing codes are skipped by default; `replace:true` deliberately resets codes and invalidates current bearer logins, preserving answers, incidents, and grades. Issuing codes pre-enrolls the roster without counting those people as joined students.
- `POST /quiz/admin/session/start` / `close` — toggle session lifecycle.
- `GET /quiz/admin/session/list` — past + live sessions.
- `GET /quiz/admin/session/live?session_id=…` — `{session, elapsed_ms, remaining_ms, students[]}` (3s poll).
- `GET /quiz/admin/session/qr?session_id=…` — PNG of join URL.
- `GET /quiz/admin/session/export?session_id=…` — `.xlsx` binary.
- `DELETE /quiz/admin/session/{session_id}` — drop session and its attempts.

## Private access codes and existing-session migration

After creating/opening a session in the instructor console:

1. Open **Personal access codes**, paste one student number per line, and issue codes.
2. Download the private CSV before leaving the session. Plain codes are returned
   only when issued; the database stores their hashes. The page never persists
   the CSV or codes in browser storage, and clears the roster/codes on session
   change, lock, or reload. The downloaded file remains until you delete it.
3. Send each student **only their own code**, individually or through Moodle.
   Never project the roster/code table or distribute the whole CSV. The common
   session QR/code can be shown to the class.
4. If a code is lost, select the affected number and explicitly enable replacement.
   This invalidates its old code and browser login; answers and grades remain.
   If an issuance request loses its response, codes may already have been issued;
   use deliberate replacement to recover rather than assuming no change occurred.

The schema migration is additive and preserves existing sessions, answers,
grades, and internal student references. The old deterministic HMAC value
remains an **internal pseudonym** so those records stay linked; it no longer
grants API access. Browser bearer tokens are independently random and stored
only as hashes on the server. Student numbers remain stored for grading and
exports; these records are identifiable personal data, not anonymous data.

**Do not update during a live quiz.** Back up first, update both frontend and
backend together, then issue private codes for every existing session that
students need to re-enter. Existing browser logins and the former number-only
login do not work with the new authentication contract.

## Privacy and retention responsibilities

This update improves access control and provides a place to link an institutional
notice. It does not establish a lawful basis or make the deployment GDPR compliant
by itself. Complete the [privacy-notice worksheet](privacy-notice-template.md)
with the university's responsible person before publishing the final notice.
It needs the controller/contact, purposes and lawful basis, data/recipients,
retention, rights, complaint information, and any relevant transfer arrangements.
The worksheet is outside the served frontend and is not a student-facing notice.

There is **no automatic deletion schedule**. Set and carry out an approved
retention period for the database, grade/incident exports, issued-code CSVs,
backups, and hosting/proxy logs. Session deletion removes its database records;
it does not remove external downloads, backups, or provider logs. Restrict those
copies to authorized university staff and retain only what the stated purpose needs.

## Smoke test

`backend/smoke_test.py` exercises the full flow against a running
backend: upload bank → create session → start → join → answer → blur →
re-fetch → export. Useful when iterating on the server.

```bash
cd backend
QUIZ_ADMIN_KEY=local-test-key python3 server.py --port 8789 &
python3 smoke_test.py --base http://localhost:8789 --admin local-test-key
```

## Deployment

The backend runs on the same Ubuntu LTS host as `labor.visiometrica.com`
and `matching.visiometrica.com`, behind the same Cloudflare Tunnel.
The deployed systemd service binds to **127.0.0.1:8003**; the development
server defaults to **8789**. Deployment and rollback instructions are in
[DEPLOYMENT.md](DEPLOYMENT.md).

Before opening the updated service to students, verify HTTPS, the correct
database path/backup, a strong `QUIZ_ADMIN_KEY`, the intended allowed frontend
origin, and the full notice URL. Validate private-code issue/login and a
cross-student access rejection using synthetic students, then remove that test
session. Check proxy/tunnel logging so it does not capture authorization headers
or request bodies. University approval, hosting arrangements and retention rules
remain operational requirements outside the code.
