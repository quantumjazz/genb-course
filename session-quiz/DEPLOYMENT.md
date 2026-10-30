# Session Quiz deployment and rollback

The existing Ubuntu deployment runs `session-quiz.service`, as the application
owner, on `127.0.0.1:8003` behind Cloudflare Tunnel. The standalone development
default is 8789; inspect the unit's actual `--port` before health checks.
Its working directory is
`~/apps/session-quiz/backend`, which resolves into the repository at
`~/apps/genb-course/session-quiz/backend`. Preserve that link and the service's
existing `QUIZ_DB_PATH`; do not create a new database during an update.
Keep the SSH address and all credentials outside this public repository.

## Before updating

1. Finish any live quiz. The authentication update invalidates older browser
   logins, and students require individually issued access codes afterward.
2. Check that the Ubuntu checkout has no local source changes. Record its
   current commit, the resolved database path, and aggregate record counts.
3. Use SQLite's backup API to create a consistent database snapshot, including
   any WAL contents, in an owner-only backup directory outside the repository.
   Verify the snapshot with `PRAGMA integrity_check`. Back up the current source
   with `git archive`; retain existing uploaded banks and environment settings.
4. Run `python3 -m unittest -v test_security.py` from `session-quiz/backend` in
   the tested checkout. The tests create disposable records and local servers.
   Run the smoke test only against an isolated disposable server/database.

## Update

Fetch the reviewed release and fast-forward the checkout to its exact commit.
Do not use `git reset --hard` or remove the database, WAL, bank uploads or service
configuration. Update frontend and backend together.

The service already has an admin key. Preserve it; the new server refuses an
empty `QUIZ_ADMIN_KEY`. Set `QUIZ_PRIVACY_NOTICE_URL` to the university's completed
notice when available. The built-in short explanation is not a full notice.

Restart `session-quiz.service` with the administrator's normal service controls.
Where the application owner has no sudo, this deployment's `Restart=always`
allows a controlled SIGTERM to its own current MainPID to request a supervised
restart. Verify ownership, unit name and restart policy first; do not signal
other Python processes or alter systemd permissions.

Startup adds the credential table and bearer-hash column without deleting
existing sessions, answers, incident evidence or grades. The old internal
pseudonyms remain record identifiers and no longer authorize student requests.

## Verify

- Confirm the service is active and its MainPID/start time changed.
- Check `/quiz/health`, `/quiz/config`, the new private-code login field, and
  the access-code panel on the instructor page through the public HTTPS URL.
- An unauthenticated admin request and a student request with only an old/query
  token must return 401.
- Confirm database integrity and unchanged pre-existing record counts; ensure
  `auth_token_hash` and `quiz_credential` exist. Do not print records or secrets.
- Issue codes for the next session's roster and distribute each code privately.
  Existing result exports remain available to the instructor.

## Rollback

Keep the pre-update source archive, database snapshot and manifest in the
private backup directory (`~/backups/session-quiz/<UTC timestamp>/`).
For a code-only rollback, restore the previous reviewed source commit and
restart the same service. The migration is additive, so the prior implementation
can still read the database; it also reintroduces the old authentication risk.
Restore the database snapshot only when necessary, after stopping the service
and accounting for records created since the snapshot. Never overwrite a live
SQLite database or discard later graded work casually.

Apply the agreed retention schedule to deployment backups as well as normal
databases and downloaded spreadsheets.
