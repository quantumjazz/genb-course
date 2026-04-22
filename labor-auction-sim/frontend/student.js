(function () {
  const {
    escapeHtml, makeLogger, toast, publicApi, fmtMoney, phaseLabel,
    connectStream, createSmoothTimer,
  } = window.LaborShared;

  const STORAGE_KEY = "labor-auction-student-v1";

  const el = {
    loginPanel: document.getElementById("login-panel"),
    loginForm: document.getElementById("login-form"),
    fieldFaculty: document.getElementById("field-faculty"),
    fieldName: document.getElementById("field-name"),
    loginSubmit: document.getElementById("login-submit"),
    leaveBtn: document.getElementById("leave-btn"),
    leaveGameBtn: document.getElementById("leave-game-btn"),
    game: document.getElementById("game"),
    meName: document.getElementById("me-name"),
    meSub: document.getElementById("me-sub"),
    meCumulative: document.getElementById("me-cumulative"),
    meRank: document.getElementById("me-rank"),
    broadcast: document.getElementById("broadcast-banner"),
    phaseTitle: document.getElementById("phase-title"),
    phaseBadge: document.getElementById("phase-badge"),
    phaseTimer: document.getElementById("phase-timer"),
    timerFill: document.getElementById("timer-fill"),
    phaseLobby: document.getElementById("phase-lobby"),
    phaseAuction: document.getElementById("phase-auction"),
    phaseEffort: document.getElementById("phase-effort"),
    phaseResolution: document.getElementById("phase-resolution"),
    phaseEnded: document.getElementById("phase-ended"),
    jobGrid: document.getElementById("job-grid"),
    backupWage: document.getElementById("backup-wage"),
    takeBackup: document.getElementById("take-backup"),
    sittingNotice: document.getElementById("sitting-out-notice"),
    effortSummary: document.getElementById("effort-summary"),
    btnWork: document.getElementById("btn-work"),
    btnSlack: document.getElementById("btn-slack"),
    effortHint: document.getElementById("effort-hint"),
    resultCard: document.getElementById("result-card"),
    historyBody: document.getElementById("history-body"),
    historyCount: document.getElementById("history-count"),
    finalSummary: document.getElementById("final-summary"),
    log: document.getElementById("status-log"),
  };

  const log = makeLogger(el.log);
  const state = {
    token: null,
    sessionCode: null,
    stream: null,
    latest: null,
    phaseDuration: 1,
    lastPhase: null,
    lastPendingFirm: null,
    effortLocked: false,
  };

  const timer = createSmoothTimer(() => 0, (seconds) => {
    if (!state.latest || !state.latest.session) return;
    const phase = state.latest.session.phase;
    if (phase === "ended" || phase === "lobby") {
      el.phaseTimer.textContent = "—";
      el.timerFill.style.width = "0%";
      return;
    }
    const remaining = Math.round(seconds);
    el.phaseTimer.textContent = `${remaining}s`;
    const pct = Math.max(0, Math.min(100, (seconds / state.phaseDuration) * 100));
    el.timerFill.style.width = `${pct}%`;
    el.timerFill.classList.toggle("low", seconds < 5);
  });

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function saveStored(value) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  }
  function clearStored() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function setPhaseVisibility(phase) {
    const map = {
      lobby: el.phaseLobby,
      auction: el.phaseAuction,
      effort: el.phaseEffort,
      resolution: el.phaseResolution,
      ended: el.phaseEnded,
    };
    for (const k of Object.keys(map)) {
      map[k].hidden = k !== phase;
    }
  }

  function phaseDurationFor(phase, params) {
    if (!params) return 30;
    if (phase === "auction") return Number(params.duration_auction || 25);
    if (phase === "effort") return Number(params.duration_effort || 20);
    if (phase === "resolution") return Number(params.duration_resolution || 15);
    return 30;
  }

  function renderLogin() {
    const stored = loadStored();
    if (stored) {
      el.fieldFaculty.value = stored.faculty_id || "";
      el.fieldName.value = stored.display_name || "";
      el.leaveBtn.hidden = false;
    }
  }

  async function login(evt) {
    evt.preventDefault();
    el.loginSubmit.disabled = true;
    try {
      const faculty = el.fieldFaculty.value.trim().toUpperCase();
      const name = el.fieldName.value.trim();
      if (!faculty || !name) throw new Error("Fill in all fields.");
      const res = await publicApi("/api/session/current/join", {
        method: "POST",
        body: { faculty_id: faculty, display_name: name },
      });
      state.token = res.token;
      state.sessionCode = res.session.code;
      saveStored({ faculty_id: faculty, display_name: name, token: res.token });
      el.loginPanel.hidden = true;
      el.game.hidden = false;
      log(`Joined the current class as ${name}.`);
      await refreshState();
      openStream();
    } catch (exc) {
      toast(exc.message, "error");
      log(`Login failed: ${exc.message}`);
    } finally {
      el.loginSubmit.disabled = false;
    }
  }

  function leave() {
    if (state.stream) state.stream.close();
    state.stream = null;
    state.token = null;
    state.sessionCode = null;
    state.latest = null;
    clearStored();
    el.game.hidden = true;
    el.loginPanel.hidden = false;
    el.leaveBtn.hidden = true;
    toast("Left the session.");
  }

  async function refreshState() {
    if (!state.token) return;
    try {
      const snap = await publicApi(`/api/student/${encodeURIComponent(state.token)}/state`);
      state.sessionCode = snap.session && snap.session.code;
      state.latest = snap;
      applySnapshot(snap);
    } catch (exc) {
      log(`State fetch failed: ${exc.message}`);
    }
  }

  function openStream() {
    if (state.stream) state.stream.close();
    state.stream = connectStream(state.sessionCode, onStreamEvent);
  }

  function onStreamEvent(ev) {
    if (ev.kind === "hello" || ev.kind === "tick" || ev.kind === "joined"
        || ev.kind === "applied" || ev.kind === "effort" || ev.kind === "paused"
        || ev.kind === "resumed" || ev.kind === "extend" || ev.kind === "broadcast"
        || ev.kind === "reveal" || ev.kind === "params" || ev.kind === "phase"
        || ev.kind === "advance" || ev.kind === "start" || ev.kind === "resume") {
      refreshState();
    }
  }

  function applySnapshot(snap) {
    if (!snap || !snap.session) return;
    const { session, student, firms_available, phase_seconds_left } = snap;
    el.meName.textContent = student.display_name;
    el.meSub.textContent = session.phase === "lobby"
      ? "Waiting to start"
      : `Round ${session.current_round} of ${session.t_rounds} · ${phaseLabel(session.phase)}`;
    el.meCumulative.textContent = fmtMoney(student.cumulative_earnings);
    el.meRank.textContent = `Rank #${student.rank}`;

    el.phaseTitle.textContent = phaseLabel(session.phase);
    el.phaseBadge.textContent = session.paused ? "Paused" : session.phase.toUpperCase();
    el.phaseBadge.className = session.paused ? "badge warn" : "badge";
    if (session.paused) {
      el.phaseTimer.textContent = "Paused";
      el.timerFill.style.width = `${Math.min(100, (Number(phase_seconds_left || 0) / state.phaseDuration) * 100)}%`;
    }

    // Phase duration for the progress bar.
    state.phaseDuration = Math.max(1, phaseDurationFor(session.phase, snap.params));
    // phase_seconds_left is given by the server; feed the smooth timer.
    if (!session.paused) {
      timer.update(phase_seconds_left == null ? state.phaseDuration : phase_seconds_left);
    }

    // Broadcast banner
    if (snap.broadcast && snap.broadcast.message) {
      el.broadcast.hidden = false;
      el.broadcast.textContent = snap.broadcast.message;
    } else {
      el.broadcast.hidden = true;
    }

    // Phase-specific rendering
    setPhaseVisibility(session.phase);

    if (session.phase === "auction") {
      renderAuction(firms_available, student, snap);
    } else if (session.phase === "effort") {
      renderEffort(student);
    } else if (session.phase === "resolution") {
      renderResolution(student);
    } else if (session.phase === "ended") {
      renderEnded(student);
    }

    // History
    renderHistory(student.history);

    // Track phase transitions for smooth UX
    if (state.lastPhase !== session.phase) {
      state.lastPhase = session.phase;
      state.effortLocked = false;
    }
  }

  function renderAuction(firms, student, snap) {
    const backupWage = snap.backup_wage != null ? snap.backup_wage : 1000;
    el.backupWage.textContent = `wage ${fmtMoney(backupWage)}`;
    // Student already chose?
    const locked = student.status === "employed" || student.status === "backup"
      || student.status === "sitting_out";
    el.takeBackup.disabled = locked;
    el.sittingNotice.hidden = student.status !== "sitting_out";

    const cards = firms.map((firm) => {
      const soldOut = firm.slots_remaining <= 0;
      const disabled = soldOut || locked;
      return `
        <div class="job-card ${disabled ? "disabled" : ""}" data-firm-type="${escapeHtml(firm.firm_type)}">
          <div class="wage">${fmtMoney(firm.wage)}</div>
          <div class="job-title">${escapeHtml(firm.firm_label)}</div>
          <div class="job-meta">${escapeHtml(firm.monitoring_label)} · ${escapeHtml(firm.contract_label)}</div>
          <div class="slots">${firm.slots_remaining} of ${firm.slots_total} seats open</div>
          <button class="button primary apply-btn" ${disabled ? "disabled" : ""} data-firm-type="${escapeHtml(firm.firm_type)}">
            ${soldOut ? "All seats taken" : "Apply"}
          </button>
        </div>`;
    }).join("");
    el.jobGrid.innerHTML = cards || `<p class="empty">No firms open.</p>`;
    el.jobGrid.querySelectorAll(".apply-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyToFirm(btn.dataset.firmType));
    });

    if (locked && student.status === "employed") {
      toast(`Hired at ${student.current && student.current.firm_label}.`, "ok", 2200);
    }
  }

  async function applyToFirm(firmType) {
    if (!state.token) return;
    try {
      state.lastPendingFirm = firmType;
      await publicApi(`/api/student/${encodeURIComponent(state.token)}/apply`, {
        method: "POST",
        body: { firm_type: firmType },
      });
      await refreshState();
    } catch (exc) {
      toast(exc.message, "error");
      log(`Apply failed: ${exc.message}`);
    }
  }

  async function takeBackup() {
    if (!state.token) return;
    try {
      await publicApi(`/api/student/${encodeURIComponent(state.token)}/backup`, {
        method: "POST",
      });
      await refreshState();
    } catch (exc) {
      toast(exc.message, "error");
      log(`Backup failed: ${exc.message}`);
    }
  }

  function renderEffort(student) {
    const current = student.current || {};
    const isSitting = student.status === "sitting_out";
    const isBackup = student.status === "backup";
    const isWaitingForNextRound = !["employed", "backup", "sitting_out"].includes(student.status);
    if (isWaitingForNextRound) {
      el.effortSummary.innerHTML = `
        <h3>Waiting for next round</h3>
        <p class="hint">You joined after the auction closed. Sit tight and you'll be able to apply when the next round begins.</p>`;
      el.btnWork.disabled = true;
      el.btnSlack.disabled = true;
      el.effortHint.textContent = "";
      return;
    }
    if (isSitting) {
      el.effortSummary.innerHTML = `
        <h3>Sitting out</h3>
        <p class="hint">You were fired last round. No choice to make this round — you'll earn 0.</p>`;
      el.btnWork.disabled = true;
      el.btnSlack.disabled = true;
      el.effortHint.textContent = "";
      return;
    }
    const monLine = isBackup
      ? `<span class="muted-text">No boss — you can slack safely here.</span>`
      : `<span class="muted-text">Monitoring: ${escapeHtml(current.monitoring_label || "—")}</span>`;
    const contractLine = isBackup
      ? ""
      : `<span class="muted-text"> · Contract: ${escapeHtml(current.contract_label || "—")}</span>`;
    el.effortSummary.innerHTML = `
      <div class="panel-header" style="margin-bottom:.4rem;">
        <h3>${escapeHtml(current.firm_label || "—")}</h3>
        <span class="badge ok">Wage ${fmtMoney(current.wage)}</span>
      </div>
      <p style="margin:0;">${monLine}${contractLine}</p>`;
    const chosen = current.effort_choice;
    el.btnWork.disabled = false;
    el.btnSlack.disabled = false;
    el.btnWork.classList.toggle("primary", chosen === "hard");
    el.btnSlack.classList.toggle("warn", chosen === "shirk");
    if (chosen) {
      el.effortHint.textContent = chosen === "hard"
        ? "You chose WORK HARD. Waiting for the phase to end."
        : "You chose SLACK OFF. Waiting to see if you're caught.";
    } else {
      el.effortHint.textContent = "No answer defaults to Work hard.";
    }
  }

  async function submitEffort(choice) {
    if (!state.token || state.effortLocked) return;
    state.effortLocked = true;
    try {
      await publicApi(`/api/student/${encodeURIComponent(state.token)}/effort`, {
        method: "POST",
        body: { choice },
      });
      await refreshState();
    } catch (exc) {
      toast(exc.message, "error");
      log(`Effort failed: ${exc.message}`);
    } finally {
      setTimeout(() => { state.effortLocked = false; }, 400);
    }
  }

  function renderResolution(student) {
    const current = student.current || {};
    const caught = current.caught === 1;
    const status = student.status;
    const earnings = Number(current.earnings || 0);
    el.resultCard.className = `result-card ${caught ? "caught" : ""}`;
    let headline;
    let detail;
    if (!["employed", "backup", "sitting_out"].includes(status)) {
      headline = "You joined mid-round.";
      detail = "This round does not count for you. You'll enter the next auction when it opens.";
    } else if (status === "sitting_out") {
      headline = "You sat out this round.";
      detail = "You'll be able to apply again next round.";
    } else if (caught) {
      headline = "Caught shirking!";
      detail = "Earnings this round: 0. You must sit out the next round.";
    } else if (current.effort_choice === "shirk") {
      headline = "You slacked off and got away with it.";
      detail = `Earnings: ${fmtMoney(earnings)} (wage + shirk bonus).`;
    } else if (status === "backup") {
      headline = "You worked the backup job.";
      detail = `Earnings: ${fmtMoney(earnings)} (wage − effort cost).`;
    } else {
      headline = "You worked hard.";
      detail = `Earnings: ${fmtMoney(earnings)} (wage − effort cost).`;
    }
    el.resultCard.innerHTML = `
      <h2 style="margin-top:0;">${escapeHtml(headline)}</h2>
      <div class="earnings-big">${fmtMoney(earnings)}</div>
      <p class="hint">${escapeHtml(detail)}</p>
      <p class="muted-text">Cumulative: ${fmtMoney(student.cumulative_earnings)} · Rank #${student.rank}</p>`;
  }

  function renderEnded(student) {
    el.finalSummary.textContent = `Final earnings: ${fmtMoney(student.cumulative_earnings)}. Rank #${student.rank}.`;
  }

  function renderHistory(history) {
    const rows = (history || []).slice().reverse();
    el.historyCount.textContent = `${history.length} round${history.length === 1 ? "" : "s"} played`;
    if (!rows.length) {
      el.historyBody.innerHTML = `<p class="empty">Nothing yet — you'll see a row appear after each round.</p>`;
      return;
    }
    const body = rows.map((r) => {
      let caughtCell = "";
      if (r.caught === 1) caughtCell = "<span class=\"badge danger\">caught</span>";
      else if (r.caught === 0) caughtCell = "<span class=\"badge muted\">no</span>";
      else caughtCell = "—";
      const choice = r.effort_choice || "—";
      return `<tr>
        <td>${r.round}</td>
        <td>${escapeHtml(r.firm_label || r.firm_type || "—")}</td>
        <td>${fmtMoney(r.wage)}</td>
        <td>${escapeHtml(choice)}</td>
        <td>${caughtCell}</td>
        <td>${fmtMoney(r.earnings)}</td>
        <td>${fmtMoney(r.cumulative_earnings)}</td>
      </tr>`;
    }).join("");
    el.historyBody.innerHTML = `
      <table class="table">
        <thead><tr><th>Round</th><th>Job</th><th>Wage</th><th>Choice</th><th>Caught?</th><th>Earnings</th><th>Cumulative</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  function init() {
    renderLogin();
    el.loginForm.addEventListener("submit", login);
    el.leaveBtn.addEventListener("click", leave);
    el.leaveGameBtn.addEventListener("click", leave);
    el.takeBackup.addEventListener("click", takeBackup);
    el.btnWork.addEventListener("click", () => submitEffort("hard"));
    el.btnSlack.addEventListener("click", () => submitEffort("shirk"));
    // Auto-uppercase the faculty field.
    el.fieldFaculty.addEventListener("input", () => {
      el.fieldFaculty.value = el.fieldFaculty.value.toUpperCase();
    });
    // Auto-resume if stored token still works.
    const stored = loadStored();
    if (stored && stored.token) {
      state.token = stored.token;
      publicApi(`/api/student/${encodeURIComponent(stored.token)}/state`).then((snap) => {
        state.sessionCode = snap.session && snap.session.code;
        state.latest = snap;
        el.loginPanel.hidden = true;
        el.game.hidden = false;
        applySnapshot(snap);
        openStream();
        log("Resumed the current class.");
      }).catch(() => {
        // Token no longer valid; stay on login screen.
        log("Previous token expired — please log in again.");
      });
    }
  }

  init();
}());
