# Labor Auction & Effort Simulation — Dashboard Specification

## 0. Purpose of this document

This document describes a browser-based, class-wide classroom simulation. Students have **no prior knowledge** of Shapiro–Stiglitz, efficiency-wage theory, or game theory. The pedagogy is **experiential**: students play the game, see aggregate patterns emerge, and the instructor names the theory in the debrief. Nothing in the student UI should use the words *efficiency wage*, *rent*, *Shapiro*, *Stiglitz*, or *moral hazard*.

The dashboard must be buildable as a single web application (front end plus a lightweight backend or serverless function for shared state). Target class size: **~50 students**.

---

## 1. High-level concept

- Each student plays a **worker** looking for a job each round.
- **Firms are bot-controlled.** Firms post wages. Wages adjust round to round based on how much shirking the bot firms observed in prior rounds.
- In each round, students see a list of job offers, pick one (or take a low-paid "backup job"), then secretly decide whether to **work hard** or **slack off**.
- Slacking off pays a private bonus but might be caught. Getting caught means **sitting out the next round's auction** (forced unemployment for one round).
- A **live class dashboard** shows aggregate wage, shirking rate, and unemployment across rounds.
- Students see their **own earnings and decision history** and their **rank** on a leaderboard.

The theory hidden underneath is the no-shirking condition `g > p·(w − ŵ)·N`. As rounds proceed, bot firms raise wages when shirking spreads — demonstrating why high wages can be profitable even for self-interested employers. The debrief reveals this.

---

## 2. Roles

| Role | Count | Controlled by |
|------|-------|---------------|
| Worker | N students (default 50) | Students (one browser each) |
| Firm | K positions (default 50, spread across 3 firm "types") | Bots (server logic) |
| Instructor | 1 | Instructor's own control panel |

The instructor controls start/pause/advance round and can tune parameters live.

---

## 3. Parameters (instructor-facing)

All parameters are set in an instructor config panel before the session and most can be tuned live.

### 3.1 Global parameters

| Symbol | UI label | Default | Meaning |
|--------|----------|---------|---------|
| `N_students` | Number of students | 50 | How many workers |
| `K_jobs` | Total job slots per round | 50 | Sum across all firm types |
| `T_rounds` | Number of rounds | 10 | Total rounds in the session |
| `w_outside` | Backup-job wage (ŵ) | 1000 | Wage if student isn't hired |
| `g` | Private gain from slacking | 1500 | Per-round bonus if student shirks and isn't caught |
| `c_effort` | Cost of working hard | 500 | Subtracted from wage if worker chooses "work hard" |
| `firing_penalty_rounds` | Forced unemployment after being caught | 1 | Student must sit out this many rounds |

### 3.2 Firm types

The instructor sets **three firm types** (can be extended). Each has a `count`, a `base_wage`, a `monitoring_prob`, and a `contract_length`.

| Firm type | Count | Base wage `w_base` | Monitoring `p` | Contract length `N` |
|-----------|-------|--------------------|----------------|---------------------|
| "Small shop" | 20 | 1500 | 0.10 | 1 |
| "Mid-size firm" | 20 | 2500 | 0.25 | 2 |
| "Big corporation" | 10 | 4000 | 0.50 | 4 |

Notes:
- `N` is the number of future rounds the worker expects to stay at this firm if not fired. In payoff calculations it is a **multiplier on the future wage premium** (see §6). Students do not see the letter `N`; they see labels like "short-term contract" and "long-term contract".
- `p` is the probability that shirking is detected this round. Students see labels: "loose monitoring", "standard monitoring", "strict monitoring".
- Students never see the numeric parameters — only the qualitative labels — unless the instructor enables an "advanced view" (optional toggle).

### 3.3 Wage adjustment rule (the auction mechanic)

Each firm adjusts its posted wage each round based on how much shirking it observed **within its own cohort of workers last round**:

```
w_new = w_base + alpha * (shirk_rate_last_round) * (w_max − w_base)
```

- `alpha` defaults to 1.0.
- `w_max` defaults to `w_base * 2`.
- `shirk_rate_last_round` is the fraction of that firm's employees who were caught shirking OR who shirked and weren't caught (firms "see" aggregate output and infer shirking; for the simulation, just use the true shirk rate).

In round 1 every firm posts `w_base` (no history yet). As shirking appears, firms raise wages; as shirking falls, wages drift back down. This is the visible "auction" behavior.

### 3.4 Heterogeneity across students (optional)

For more realistic play, give each student a personalized `g_i` drawn from a small range (e.g., `g` ± 20%). This mirrors Victor's S&L / De Beers exercises where parameters vary per student. Toggle in config.

---

## 4. Round structure

A **round** is one full cycle of auction + effort + resolution. Duration: about **60–90 seconds**. The instructor can pause between rounds.

### 4.1 Phase A — Auction (20–30 seconds)

1. At round start, the server computes each firm's posted wage (§3.3).
2. Students see a **job board**: up to ~6 offers visible at a time, each showing:
   - Wage (numeric)
   - Monitoring label ("loose" / "standard" / "strict")
   - Contract label ("short-term" / "medium-term" / "long-term")
   - Number of slots remaining at that firm
3. Students click one offer to apply, or click "Take backup job" to take the outside option immediately.
4. Applications are resolved **in real time** on a first-come, first-served basis per firm slot. When a firm fills all its slots, its listing is removed from the board.
5. Students who have not applied before the phase timer ends are auto-assigned the backup job.
6. Students under a `firing_penalty` (caught shirking last round) **cannot apply** this round — they get the backup job automatically and see a message: "You were fired last round. You must take the backup job this round."

### 4.2 Phase B — Effort choice (20 seconds)

1. Every employed student sees their job card and two buttons: **"Work hard"** and **"Slack off"**.
2. They must click one before the timer runs out. No-choice default: "Work hard".
3. Students on the backup job make the same effort choice (the parameters for the backup job are `w_outside`, with monitoring `p_outside` default 0 — so shirking on backup work is never caught. This creates the intended asymmetry.)

### 4.3 Phase C — Resolution (10 seconds)

For every student:

1. If they chose **"Work hard"**: `earnings = w − c_effort`.
2. If they chose **"Slack off"**:
   - Draw random `u ~ Uniform(0,1)`.
   - If `u < p` (where `p` is this job's monitoring), worker is **caught**.
     - Earnings this round: `0` (fired before payday — parameter; alternative: earn `w − c_effort − penalty`).
     - Worker is flagged for `firing_penalty_rounds` of forced unemployment.
   - If `u ≥ p`, worker is **not caught**: `earnings = w + g`.

Show each student a clear result card: "You earned X this round. You were/weren't caught. Next round status: OK / sitting out."

### 4.4 Phase D — Dashboard update and pause (10 seconds)

The shared class dashboard refreshes. Instructor can pause, comment, or advance to next round.

---

## 5. Economic payoffs (full formulas, instructor reference only)

These are the formulas the dashboard must implement. **Do not expose to students during play.**

### 5.1 One-period payoffs for an employed worker

Let `w` = posted wage, `p` = detection probability, `g` = shirk bonus, `c` = effort cost.

- Work hard: `π_hard = w − c`
- Shirk, not caught (prob `1 − p`): `π_shirk_safe = w + g`
- Shirk, caught (prob `p`): `π_shirk_caught = 0` (plus forced unemployment next round)

Expected value of shirking: `E[π_shirk] = (1 − p)(w + g) + p·0 = (1 − p)(w + g)`.

### 5.2 The hidden no-shirking condition

A forward-looking worker compares continuation values. In the textbook form the condition for honesty is `g ≤ p·(w − ŵ)·N`. In this simulation we operationalize `N` via the contract-length multiplier: a worker at a "long-term" firm loses `N` expected future wage-premium periods if fired. Concretely, if caught, the worker loses:

```
loss_if_caught = (w − w_outside) * N + current_round_wage
```

So an expected-value-maximizing worker shirks iff:

```
(1 − p)(w + g) > (w − c) + p * [w_outside * firing_penalty_rounds − (w − w_outside) * N]
```

The instructor does **not** need to tell students this. The simulation will naturally produce the comparative statics:

- Low `w` and low `p` → most students shirk, wages get bid up.
- High `w` and high `p` → shirking collapses, wages can stabilize.
- Short `N` → shirking is rational even at high wages (end-game problem).

### 5.3 Backup-job payoff

`π_backup = w_outside − c_effort` if "work hard", or `w_outside + g` if "slack off" (never caught, because `p_outside = 0`). This makes the backup job unambiguously worse than a high-wage, high-monitoring firm for an honest worker — which is the whole pedagogical point.

---

## 6. Bot-firm behavior (server-side)

### 6.1 Firm state

Each firm tracks:
- `firm_id`
- `firm_type` (links to base parameters)
- `current_wage`
- `slots_total`, `slots_filled`
- `history`: list of `{round, wage, n_hired, n_shirked, n_caught}`

### 6.2 Round-start computation

At the start of each round after round 1:

```
shirk_rate = n_shirked_last_round / max(n_hired_last_round, 1)
w_new = w_base + alpha * shirk_rate * (w_max − w_base)
# optional decay when shirking is low:
w_new = max(w_base, w_new - beta * (1 − shirk_rate) * (w_new - w_base))
current_wage = round(w_new)
```

Defaults: `alpha = 1.0`, `beta = 0.3`.

### 6.3 Why this is an "auction"

From the students' side, this looks like firms competing to attract them: wages rise when shirking rises, and high-monitoring / long-contract firms can offer the highest wages. The dashboard should include a small **wage-over-time chart per firm type** so students can see the "bidding up".

---

## 7. Student UI (one screen per student)

The student view is a single responsive page. Three main panels, stacked on mobile.

### 7.1 "My status" panel (always visible)

- Student display name (they enter at login).
- Cumulative earnings.
- Current round number / total rounds.
- Current status: "Choosing a job", "Choosing effort", "Waiting for results", "Sitting out this round".
- Leaderboard rank (live, among all connected students).

### 7.2 Main action panel (changes with phase)

**Auction phase:**
- Grid of job cards. Each card shows:
  - Wage (big number)
  - Monitoring label
  - Contract-length label
  - Remaining slots
  - "Apply" button
- One "Take backup job — wage X" button at the bottom.

**Effort phase:**
- Current job summary at top.
- Two huge buttons: **"Work hard"** (subtitle: "Steady paycheque, minus effort cost") and **"Slack off"** (subtitle: "Bigger payoff if you get away with it").
- Countdown timer.

**Resolution phase:**
- Result card: earnings this round, caught / not caught, next-round status.

### 7.3 "My history" panel (always visible)

A small table with one row per round:

| Round | Job type | Wage | My choice | Caught? | Earnings |
|-------|----------|------|-----------|---------|----------|

Plus a sparkline of cumulative earnings.

### 7.4 Language rules

Keep all student-facing text in plain language. Examples:

| Technical term | Student-facing wording |
|----------------|------------------------|
| Outside option / reservation wage | "Backup job" |
| Detection probability | "How closely the boss watches" |
| Time horizon / contract length | "How long the job lasts" |
| Shirk | "Slack off" |
| Efficiency wage | (never mentioned) |
| Rent | (never mentioned) |

---

## 8. Shared class dashboard (projected on screen)

This is one separate screen the instructor projects. It has three widgets.

### 8.1 Market metrics over time

Three line charts, one x-axis shared (round number):

1. **Average posted wage**, one line per firm type, plus an overall average.
2. **Shirking rate** — fraction of employed students who chose "Slack off" — line chart across rounds.
3. **Unemployment rate** — fraction of students who took the backup job or were sitting out — line chart across rounds.

### 8.2 This-round snapshot

- Number of students currently in each phase (for instructor awareness).
- Number of applications in progress per firm.
- Live "caught shirking" counter as results resolve.

### 8.3 Leaderboard

Top 10 students by cumulative earnings, with display name. Updates live.

### 8.4 Optional "reveal" toggle

An instructor-only switch that reveals the hidden parameters on the shared dashboard (`g`, `p` per firm, `N`). Use this during the debrief only.

---

## 9. Instructor control panel

A private screen for the instructor.

- **Session controls:** Start session, Pause, Advance round, End session.
- **Timer overrides:** extend current phase by 10 / 30 / 60 seconds.
- **Parameter tuning (live):** edit `g`, `c_effort`, `w_outside`, `firing_penalty_rounds`, and per-firm-type `w_base`, `p`, `N` between rounds.
- **Broadcast message:** send a text message to all student screens (e.g., "Round 6 coming up — think carefully!").
- **Export:** download full session data as CSV — one row per student per round, with all choices and outcomes — for post-hoc analysis.

---

## 10. Data model

### 10.1 Per-student record

```json
{
  "student_id": "abc123",
  "display_name": "Ivan",
  "cumulative_earnings": 24000,
  "status": "employed" | "backup" | "sitting_out",
  "firing_penalty_remaining": 0,
  "current_round": {
    "firm_id": "firm_17",
    "wage": 2500,
    "monitoring": 0.25,
    "contract_length": 2,
    "effort_choice": "hard" | "shirk" | null,
    "caught": false,
    "earnings_this_round": 2000
  },
  "history": [ /* one entry per past round */ ]
}
```

### 10.2 Per-firm record

```json
{
  "firm_id": "firm_17",
  "firm_type": "mid",
  "current_wage": 2500,
  "monitoring": 0.25,
  "contract_length": 2,
  "slots_total": 2,
  "slots_filled": 2,
  "employee_ids": ["abc123", "def456"],
  "history": [ /* per-round stats */ ]
}
```

### 10.3 Round log (one row per student-round, for CSV export)

`student_id, round, firm_id, firm_type, wage_posted, monitoring, contract_length, effort_choice, caught, earnings, cumulative_earnings, status`

---

## 11. Timing and synchronization

- Server is the authoritative clock. All phase transitions are server-pushed (e.g., WebSocket or Server-Sent Events).
- Students' pending actions at phase-end default to the safe option (Apply to first offer → backup job; Effort → Work hard).
- If a student disconnects mid-round, their cumulative state is preserved; on reconnect they see the current phase.

---

## 12. Suggested defaults for a 50-student, 10-round session

- 3 firm types as in §3.2.
- `w_outside = 1000`, `g = 1500`, `c_effort = 500`, `firing_penalty = 1`.
- Round length: ~60 seconds (20s + 20s + 10s + 10s).
- Total session time: ~12–15 minutes for 10 rounds plus a 10-minute debrief.

Expected narrative arc:

- **Rounds 1–2:** Shirking is widespread (students test the system). Firms observe this.
- **Rounds 3–5:** "Big corporation" wages rise sharply; shirking at big firms collapses. Shirking persists at small shops.
- **Rounds 6–8:** Wage dispersion widens. A "career track" emerges: students who stayed at big corporations have higher cumulative earnings than shirkers who got caught.
- **Rounds 9–10:** Last-round effect — some students shirk on the last round because there's no future. This is the **end-game problem** and is the perfect opening for the debrief.

---

## 13. Debrief prompts (after the simulation)

For the instructor to run with the reveal toggle on:

1. *"Why did wages at big firms go up after round 2?"* — introduces the idea that firms rationally pay more to reduce shirking.
2. *"Why was slacking off common at small shops but rare at big corporations?"* — introduces monitoring × wage trade-off.
3. *"Did you notice that more people slacked off in the last round? Why?"* — introduces the end-game / horizon effect and `N`.
4. *"Was it ever rational to take the backup job instead of applying?"* — introduces outside options and reservation wages.
5. *Finally, write on the board:* `g vs p·(w − ŵ)·N`. *"This is what you just lived. Shapiro and Stiglitz got a lot of attention for this in 1984."*

---

## 14. Build-order recommendation (for the implementing LLM)

Build in this order:

1. **Static prototype**: single-player mode with bot firms only. Get the round loop, payoffs, and history right.
2. **Multi-student sync**: add a simple backend (Node/Express + WebSocket, or Firebase, or Supabase realtime) so 50 browsers share state.
3. **Instructor controls**: pause, advance, tune parameters.
4. **Shared projection dashboard**: the three charts and the leaderboard.
5. **CSV export**.
6. **Optional polish**: personalized `g_i`, advanced reveal toggle, firm-type customization UI.

A single-file HTML + React + Tailwind artifact can carry the single-player prototype. For the multi-student class mode, a small Node/Express + Socket.IO backend hosted on something like Railway or Render, plus a Vercel-hosted front end, is sufficient.

---

## 15. Non-goals (to keep difficulty minimal)

- **No sealed bids from students.** Students do not bid numerically. They only click "Apply" or pick effort.
- **No continuous effort levels.** Binary choice only: work hard or slack off.
- **No risk aversion modeling.** Assume risk-neutral utility = earnings.
- **No coalitions, no cross-student communication within the dashboard.**
- **No explicit game-theory vocabulary on the student UI.** Theory stays in the debrief.
