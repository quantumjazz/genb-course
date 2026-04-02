# Matching Dashboard MVP

This folder contains a classroom-oriented prototype of the "central office" described in the Milgrom & Roberts hospital-intern matching example and in the local lecture deck at `/Users/victor/Documents/Courses/society_economics_business/01-защо-съществуват-фирмите/matching-lecture.qmd`.

The design follows the case closely:

- hospitals and candidates submit ordinal rankings;
- a centralized service runs deferred acceptance;
- the result is evaluated in terms of matches and blocking pairs;
- v1 excludes couples, because the lecture notes that simple stability guarantees break once couples submit joint preferences.

## Architecture

- `frontend/`: static dashboard that can be deployed to GitHub Pages, Netlify, Cloudflare Pages, or served locally.
- `backend/`: small Python 3 API for Ubuntu LTS laptops. It uses only the standard library plus SQLite.

GitHub Pages cannot itself host the centralized algorithm. The intended setup is:

1. the static frontend lives on GitHub Pages or a similar host;
2. the Ubuntu laptop runs the backend and SQLite database;
3. the frontend calls the backend over HTTPS.

For a classroom or pilot, this is realistic. For anything public-facing, add TLS, authentication, and a stable network path.

## What The MVP Supports

- hospitals with capacities;
- candidates with one seat each;
- participant self-registration with only role and name;
- a public classroom submission flow plus an admin control panel;
- explicit market phases: registration open, ranking open, locked;
- one normalized name per market, so the first role claim is binding;
- incomplete rankings;
- top-10 participant rankings for classroom-scale markets;
- hospital-proposing deferred acceptance;
- candidate-proposing deferred acceptance, so you can demonstrate the asymmetry highlighted in the lecture;
- a step trace of proposals and rejections;
- blocking-pair detection after each run.

## Student And Admin Workflow

1. Participants open the frontend, choose a side, enter their name, and start or resume their own entry.
2. During `registration_open`, the backend creates new roles automatically. A normalized name can only appear once in the whole market.
3. The admin closes registration and opens `ranking_open` so participants can submit up to 10 opposite-side preferences.
4. The admin then sets the market to `locked` and runs the centralized allocation on a frozen market.

The current submission flow is intentionally lightweight: it uses only role and name, so it discourages duplicates but does not provide real authentication. If you need stronger control, the next step is per-role access codes or authenticated logins.

## What It Does Not Support Yet

- couples or joint applications;
- participant-specific authentication;
- audit logs and immutable submissions;
- production-grade hosting, observability, or backups.

## Backend: Run On Ubuntu LTS

```bash
python3 /Users/victor/Documents/Courses/society_economics_business/matching-dashboard/backend/server.py \
  --host 0.0.0.0 \
  --port 8787
```

Optional environment variables:

- `MATCHING_ADMIN_KEY`: shared key required for the admin panel and admin-only API routes.
- `MATCHING_ALLOWED_ORIGIN`: exact frontend origin to allow via CORS.
- `MATCHING_DB_PATH`: SQLite path. Defaults to `backend/data/matching.db`.

Example:

```bash
MATCHING_ADMIN_KEY=change-me \
MATCHING_ALLOWED_ORIGIN=https://your-user.github.io \
python3 /Users/victor/Documents/Courses/society_economics_business/matching-dashboard/backend/server.py
```

## Frontend: Serve Or Deploy

Local static preview:

```bash
python3 -m http.server 8080
```

Run that command inside:

```text
/Users/victor/Documents/Courses/society_economics_business/matching-dashboard/frontend
```

Then open:

- `http://localhost:8080`

Or publish the contents of `frontend/` to GitHub Pages.

The current frontend is wired to the production API at `https://matching.visiometrica.com`, so participants cannot switch the backend from the page. The page does not persist participant names or the admin key. If you need to point the dashboard at a different backend, change `API_BASE` in `frontend/app.js` before deploying.

## Recommended Deployment Shape

For a small seminar or demo:

- frontend: GitHub Pages;
- backend: Ubuntu laptop;
- database: local SQLite;
- exposure: Tailscale, Cloudflare Tunnel, or a reverse proxy with TLS.
- admin protection: set `MATCHING_ADMIN_KEY` so only the instructor can inspect full rankings and run the match.

For a real admissions workflow:

- move the backend off a laptop;
- add per-user auth;
- store submissions immutably;
- add backups and monitoring;
- define governance around who can rerun or overwrite a match.
