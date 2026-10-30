# Session Quiz institutional privacy-notice worksheet

**DRAFT WORKSHEET — not a final privacy notice and not served to students.**
Complete the bracketed fields with the university's responsible person or DPO,
resolve the questions below, and publish the approved notice at an appropriate
institutional HTTPS address. Set `QUIZ_PRIVACY_NOTICE_URL` to that address.
The app's short explanation does not replace this notice. Do not publish this
worksheet with unresolved placeholders.

## Controller and contacts

- Controller's legal name and postal address: **[complete]**.
- Contact for this quiz and requests about personal data: **[complete]**.
- Data protection officer/contact, where applicable: **[complete]**.

## Purposes, legal basis and participation

- Educational/assessment purposes: **[describe each purpose]**.
- Lawful basis and relevant national/institutional provisions: **[confirm]**.
- Is participation required, what information is required, and what happens if
  a student cannot provide it? **[explain]**.
- Alternative or accommodation for device/fullscreen/accessibility problems:
  **[describe]**.
- Is any data also used for research, publication, or other purposes? **[confirm
  separately; explain any different basis and safeguards]**.

## Data and decisions

Confirm that the notice accurately covers the deployed configuration:

- Student/faculty number, session membership and join/end times.
- Question attempts, selected answers, correctness, scores, and response times.
- Focus/fullscreen/lifecycle events, timestamps and the limited technical
  metadata actually collected by the deployed version.
- Session-specific internal pseudonyms, hashed private access codes and hashed
  browser bearer credentials; browser session storage used for the current tab.
- Network/access information collected by hosting, tunnel/proxy or static-host
  providers: **[inventory the actual logs; do not assume no IP logging]**.

Explain how automated scoring and focus-change rules work, including question
replacement or a session ending under the selected policy: **[complete]**.
Explain their effect on assessment, the human review process, and how a student
can explain or challenge an outcome: **[complete]**. A focus/fullscreen event
does not itself establish cheating; do not describe it as proven misconduct.

## Recipients, hosting and transfers

- Authorized staff and who receives grade/incident exports: **[complete]**.
- Backend operator, location and hosting arrangements: **[complete]**.
- Static frontend host and tunnel/proxy providers, their roles and agreements:
  **[complete]**.
- Any recipients outside the EEA and applicable safeguards, or confirmed absence
  of such transfers: **[complete based on actual arrangements]**.
- How private codes are delivered individually: **[complete]**. A whole roster
  or credential CSV must not be projected or shared with the class.

## Retention

There is no automatic purge in the current application. Define a period or
clear criterion, owner, and deletion procedure for every copy:

| Records | Retention period/criterion | Responsible person and deletion procedure |
|---|---|---|
| Quiz session, attempts, incidents and credential hashes | [complete] | [complete] |
| Official grading records, if held separately | [complete] | [complete] |
| Issued-code CSVs and delivery messages | [complete] | [complete] |
| Downloaded result/incident spreadsheets | [complete] | [complete] |
| Backups | [complete] | [complete] |
| Server, tunnel/proxy and static-host logs | [complete] | [complete] |

Deleting an application session does not remove downloaded files, provider
logs, or backups. Confirm how those copies expire and how a restored backup
avoids retaining records beyond the agreed schedule: **[complete]**.

## Rights and complaints

Explain the rights applicable to the confirmed lawful basis, any relevant
limits, and how students exercise them: **[complete]**. State any right to
withdraw consent only if consent is actually relied upon, and explain how it
works without substituting consent for the institution's basis analysis.

Give the competent supervisory authority's name, contact details and complaint
route: **[confirm and complete]**.

## Release check

- [ ] No placeholders remain; the university has confirmed the content.
- [ ] The deployed behavior, recipients and logs match the description.
- [ ] The notice is reachable before login at the configured HTTPS URL.
- [ ] A named owner carries out retention and handles student requests/review.
- [ ] The class-facing rules and any Moodle instructions match the notice.
