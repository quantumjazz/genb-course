# Labor Auction Classroom Simulation

A browser-based classroom simulation of labor auctions, effort choice and
shirking. Students log in with their faculty ID, the instructor runs the
session, and the class watches aggregate wages, shirking, and unemployment
emerge live on a projection dashboard. The full pedagogical design lives in
[`labor-auction-simulation-spec.md`](./labor-auction-simulation-spec.md).

The theory hidden underneath is the Shapiro–Stiglitz no-shirking condition
`g ≤ p · (w − ŵ) · N`. Students never see any of that vocabulary during play;
the instructor reveals it in the debrief with the **Reveal** toggle.

## Architecture

Mirrors the sibling `matching-dashboard/` project:

- `frontend/` — static HTML + vanilla JS + CSS. Deployable to any static
  host (GitHub Pages, Netlify, Cloudflare Pages) or served locally.
- `backend/` — Python 3 stdlib HTTP server + SQLite. Intended to run on an
  Ubuntu LTS laptop.

The backend is authoritative: it owns the round clock, runs the bot-firm
logic, and reverse-maps student tokens to faculty IDs (admin-only).

## What the three pages do

| Page | For | What it does |
|------|-----|--------------|
| `index.html` | Everyone | Landing page with links to the other three views. |
| `student.html` | Students | Join the current class with a faculty ID and screen name, then play through the rounds. |
| `instructor.html` | Instructor | Create a session, start/pause/advance rounds, tune parameters live, send broadcast messages, download CSV, reveal hidden parameters. |
| `dashboard.html` | Projected in class | Live charts (wages per firm type, shirking rate, unemployment), leaderboard, this-round snapshot. |

## Student login and identification

Each student enters their **faculty ID** (e.g. `F123456`) plus a display name.
The student page joins the **current open class** automatically; students do
not need to type a session code. The server **does not store the faculty ID**.
Instead, at session
creation the server generates a random 32-byte `pseudonym_key` kept only
in the `session` row (never exposed by any API). When a student joins,
the server computes

```
token = base32(HMAC-SHA256(pseudonym_key, upper(faculty_id)))[:12]
```

The faculty ID lives only in the request memory for the duration of the
`/join` call — nothing about it touches disk. The derived token is what
the student uses for every subsequent API call, and it's what shows up
in the roster, leaderboard, and CSV export.

Two consequences:

- Re-entering the same faculty ID in the same session always recomputes
  the same token, so reconnecting from a different browser or phone is
  safe and lands the student back in their own game state.
- Tokens cannot be correlated across sessions: each session has its own
  random `pseudonym_key`, so the same faculty ID produces unrelated
  tokens in different sessions.

### Reverse-lookup after class

The CSV contains tokens, not names. To map tokens back to your roster,
the instructor page has a **roster reverse-lookup** panel: paste your
class roster of faculty IDs, and the server recomputes the tokens (the
same deterministic HMAC) and returns the `{id: token}` mapping. The
mapping is rendered in the browser only — it is never persisted on the
server. Under the hood this calls the admin-only endpoint:

```
POST /api/session/:code/tokenize  → {ids: [...]} → {mapping: {id: token}}
```

## Round lifecycle

Each round has three phases (all durations configurable):

1. **Auction** (default 25s) — students pick a firm or take the backup job.
   Firm wages adjust between rounds based on observed shirking.
2. **Effort** (default 20s) — students choose "Work hard" or "Slack off".
3. **Resolution** (default 15s) — payoffs resolve, caught shirkers sit out
   the next round, dashboard refreshes.

Unanswered phases default to the safe option: auto-apply goes to the backup
job, auto-effort goes to "Work hard". The instructor can **pause**,
**advance** manually, or **extend** the current phase by +10/+30/+60s.

## Run the backend

On an Ubuntu LTS laptop (or macOS / Linux dev box):

```bash
LABOR_ADMIN_KEY=change-me \
python3 backend/server.py \
  --host 0.0.0.0 --port 8788
```

Optional environment variables:

- `LABOR_ADMIN_KEY` — shared secret required for any admin endpoint (create
  session, start, advance, CSV, etc). If unset, the server runs in
  **open/dev mode** — do not expose it to the network without this key.
- `LABOR_ALLOWED_ORIGIN` — exact frontend origin allowed by CORS.
- `LABOR_DB_PATH` — SQLite path. Defaults to `backend/data/labor.db`.

## Serve the frontend

For a local preview:

```bash
cd frontend
python3 -m http.server 8080
```

Then open `http://localhost:8080`. The frontend auto-detects `localhost` and
points at `http://localhost:8788` by default. To target a remote backend,
edit `API_BASE` in `shared.js` or set `window.LABOR_API_BASE` from the page
before `shared.js` loads.

For classroom deployment:

1. Publish `frontend/` to GitHub Pages (or any static host).
2. Run the backend on an Ubuntu laptop at e.g. `labor.visiometrica.com`
   (set up TLS via Cloudflare Tunnel or Caddy / nginx).
3. Set `API_BASE` in `shared.js` to the public backend URL before publishing
   the static site.

## Recommended session defaults

See §12 of the spec:

- ~50 students, 10 rounds, ~60s per round, ~15 minutes total + 10-minute
  debrief.
- Three firm types as in §3.2 of the spec (already the defaults in the
  instructor's "Create a session" form).
- Reveal hidden parameters **only during the debrief**.

## Session data model

SQLite tables (see `backend/server.py::SCHEMA`):

- `session` — one row per session. Owns the phase, round counter, paused
  flag, full parameter blob, reveal toggle, broadcast message, and the
  random `pseudonym_key` used to derive student tokens.
- `student` — one row per student per session. Deterministic per-session
  token, display name, current-round fields, cumulative earnings. **No
  faculty ID is stored.**
- `firm` — one row per firm *instance* (slot). Firms are pre-created at
  session creation time from `firm_types × count`.
- `round_log` — one row per student per round. Full history for CSV export.
- `firm_round` — one row per firm per round with `n_hired`, `n_shirked`,
  `n_caught` — this is what drives the next round's wage update.
- `round_meta` — one row per completed round with `avg_wage`, `shirk_rate`,
  `unemployment_rate` — drives the projection dashboard charts.

## API surface

Public (no key):

- `POST /api/session/current/join` → `{faculty_id, display_name} → {token, student_id, display_name, session}`
- `GET /api/student/:token/state` → full student snapshot (session, current
  job, firms available, history, phase timer).
- `POST /api/student/:token/apply` → `{firm_type}` claims the first open
  slot of that type. First-come, first-served.
- `POST /api/student/:token/backup` → take the backup job.
- `POST /api/student/:token/effort` → `{choice: "hard" | "shirk"}`.
- `GET /api/session/:code/dashboard` → public aggregate snapshot (wages,
  shirk rate, unemployment, leaderboard).
- `GET /api/session/:code/events` → **SSE** event stream. Events arrive on
  phase changes, joins, parameter updates, etc. Polling fallback in
  `shared.js` if the stream fails.

Admin (requires `X-Admin-Key: $LABOR_ADMIN_KEY`):

- `POST /api/session` → create a new session with parameters. Only one
  non-ended session may exist at a time.
- `GET /api/admin/sessions` → list all sessions.
- `DELETE /api/session/:code` → delete a session.
- `GET /api/session/:code/admin` → full admin snapshot (tokens + per-student state; no faculty IDs).
- `GET /api/session/:code/csv` → CSV export (one row per student-round, keyed by token).
- `POST /api/session/:code/tokenize` → `{ids: [...]}` → `{mapping: {id: token}}` for roster-based reverse-lookup.
- `POST /api/session/:code/start` / `/advance` / `/pause` / `/resume`.
- `POST /api/session/:code/extend` → `{seconds}`.
- `POST /api/session/:code/params` → `{params}` (live parameter tuning).
- `POST /api/session/:code/broadcast` → `{message}`.
- `POST /api/session/:code/reveal` → `{on: boolean}`.

## Development notes

The backend uses one background `TickThread` that scans for sessions whose
current phase has expired (every 500 ms) and advances them. All mutations
on a given session serialize through a session-scoped lock so the tick
thread and instructor actions don't race.

To reset a local database:

```bash
rm backend/data/labor.db backend/data/labor.db-wal backend/data/labor.db-shm
```

## Non-goals (intentional)

- No sealed bids from students — they only click "Apply" / "Take backup".
- No continuous effort levels — binary "Work hard" vs "Slack off".
- No explicit game-theory vocabulary on the student UI.
- No per-student authentication beyond the derived token — fine for
  classroom use, not for public deployment.
