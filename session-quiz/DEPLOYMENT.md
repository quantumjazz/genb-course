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

1. Finish any live quiz. Update frontend and backend together. New first entries
   are automatic and bind to a private browser credential; there are no
   individual codes, roster uploads or routine approvals. Existing records
   remain protected: reopening an old student record without its recognized
   browser credential needs exceptional recovery, not a number-only claim.
2. Check that the Ubuntu checkout has no local source changes. Record its
   current commit, the resolved database path, and aggregate record counts.
3. Use SQLite's backup API to create a consistent database snapshot, including
   any WAL contents, in an owner-only backup directory outside the repository.
   Verify the snapshot with `PRAGMA integrity_check`. Back up the current source
   with `git archive`; retain existing uploaded banks and environment settings.
   Restrict the dedicated data/upload directories to their owner (0700), and
   database, WAL, SHM and uploaded bank files to 0600. Do not chmod a shared
   parent directory or the source checkout wholesale.
4. Run `python3 -m unittest -v test_security.py` from `session-quiz/backend` in
   the tested checkout. The tests create disposable records and local servers.
   Run the smoke test only against an isolated disposable server/database.

## Update

Fetch the reviewed release and fast-forward the checkout to its exact commit.
Do not use `git reset --hard` or remove the database, WAL, bank uploads or service
configuration. Update frontend and backend together.

The service already has an admin key. Preserve it; the new server refuses an
empty `QUIZ_ADMIN_KEY`. The instructor console's course-wide privacy panel saves
confirmed university information once in the existing database. Fill its six
inline fields with confirmed details for this app and link any related
institutional policy. Unknown basis/retention/recipient/rights information must
stay empty and retain the incomplete-information warning; a generic policy URL
does not complete these fields. The [NBU privacy policy (2018)](https://gdpr.nbu.bg/download/upizi/gdpr/Politika_NBU_GDPR-20180608.pdf)
supplies institutional controller details, and the [official site](https://gdpr.nbu.bg/)
lists `dpo@nbu.bg`. Confirm the applicability/current internal versions of these
dated materials. They do not approve this quiz's processing or establish its
retention period. Do not infer
or apply a six-year quiz retention rule from generic institutional materials.
`QUIZ_PRIVACY_NOTICE_URL` is an environment fallback until the URL setting is
saved. A saved blank URL deliberately overrides that fallback. The completeness
flag requires all six inline fields and is not a finding of legal compliance.
The app does not schedule deletion.

Restart `session-quiz.service` with the administrator's normal service controls.
Where the application owner has no sudo, this deployment's `Restart=always`
allows a controlled SIGTERM to its own current MainPID to request a supervised
restart. Verify ownership, unit name and restart policy first; do not signal
other Python processes or alter systemd permissions.

Startup adds browser/recovery credential fields and a settings table without
deleting existing sessions, answers, incident evidence or grades. The old internal
pseudonyms remain record identifiers and no longer authorize student requests.

## Verify

- Confirm the service is active and its MainPID/start time changed.
- Check `/quiz/health`, `/quiz/config`, the student login with only session code
  and faculty number, and the instructor's course-wide privacy settings through
  the public HTTPS URL. Ensure no individual-code/roster issuance UI remains.
- An unauthenticated admin request and a student request with only an old/query
  token must return 401.
- Confirm database integrity and unchanged pre-existing record counts; ensure
  the browser/recovery credential fields and `quiz_settings` exist. Do not print
  records or secrets.
- On a disposable synthetic session, verify automatic first entry, same-tab
  rejoin and rejection from a different browser knowing the same faculty number.
  Test exceptional recovery: old browser revoked immediately, link expires in
  five minutes, a second browser cannot redeem it after use, same-browser retry
  works until expiry, and answers/grades remain. Remove only the synthetic session.
- Recovery is available for an already joined student in a nonclosed session.
  It is not routine enrollment approval. Closed-session exports remain available.
- Verify saved privacy information survives a service restart. Saving a retention
  description does not delete records; no automated purge is introduced.

## Rollback

Keep the pre-update source archive, database snapshot and manifest in the
private backup directory (`~/backups/session-quiz/<UTC timestamp>/`).
For a code-only rollback, restore the previous reviewed source commit and
restart the same service. The migration preserves earlier tables, but a rollback
also restores the earlier login contract. Check its effects on browser-bound
students before resuming a class; database readability alone is insufficient.
Restore the database snapshot only when necessary, after stopping the service
and accounting for records created since the snapshot. Never overwrite a live
SQLite database or discard later graded work casually.

Apply the agreed retention schedule to deployment backups as well as normal
databases and downloaded spreadsheets.
