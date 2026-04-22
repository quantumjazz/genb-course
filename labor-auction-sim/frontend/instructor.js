(function () {
  const {
    escapeHtml, makeLogger, toast, publicApi, adminApi, fmtMoney, fmtPercent,
    phaseLabel, connectStream, API_BASE,
  } = window.LaborShared;

  const KEY_STORAGE = "labor-auction-admin-key-v1";
  const ACTIVE_STORAGE = "labor-auction-active-session-v1";

  const DEFAULT_FIRM_TYPES = [
    { key: "small", label: "Small shop", count: 20, base_wage: 1500, monitoring: 0.10, contract_length: 1,
      monitoring_label: "loose monitoring", contract_label: "short-term contract" },
    { key: "mid", label: "Mid-size firm", count: 20, base_wage: 2500, monitoring: 0.25, contract_length: 2,
      monitoring_label: "standard monitoring", contract_label: "medium-term contract" },
    { key: "big", label: "Big corporation", count: 10, base_wage: 4000, monitoring: 0.50, contract_length: 4,
      monitoring_label: "strict monitoring", contract_label: "long-term contract" },
  ];

  const el = {
    apiHost: document.getElementById("api-host"),
    adminKey: document.getElementById("admin-key"),
    saveKey: document.getElementById("save-key"),
    forgetKey: document.getElementById("forget-key"),
    refreshList: document.getElementById("refresh-list"),
    sessionsList: document.getElementById("sessions-list"),
    tRounds: document.getElementById("p-t-rounds"),
    dAuc: document.getElementById("p-duration-auction"),
    dEff: document.getElementById("p-duration-effort"),
    dRes: document.getElementById("p-duration-resolution"),
    wOut: document.getElementById("p-w-outside"),
    pG: document.getElementById("p-g"),
    pC: document.getElementById("p-c-effort"),
    pFire: document.getElementById("p-firing"),
    alpha: document.getElementById("p-alpha"),
    beta: document.getElementById("p-beta"),
    wmax: document.getElementById("p-wmax"),
    heter: document.getElementById("p-heter"),
    spread: document.getElementById("p-spread"),
    firmTypes: document.getElementById("firm-types"),
    createBtn: document.getElementById("create-session"),
    controlPanel: document.getElementById("control-panel"),
    activeCode: document.getElementById("active-code"),
    activePhase: document.getElementById("active-phase"),
    activeRound: document.getElementById("active-round"),
    activeTimer: document.getElementById("active-timer"),
    mStudents: document.getElementById("m-students"),
    mEmployed: document.getElementById("m-employed"),
    mBackup: document.getElementById("m-backup"),
    mCaught: document.getElementById("m-caught"),
    btnStart: document.getElementById("btn-start"),
    btnAdvance: document.getElementById("btn-advance"),
    btnPause: document.getElementById("btn-pause"),
    btnResume: document.getElementById("btn-resume"),
    btnExt10: document.getElementById("btn-extend-10"),
    btnExt30: document.getElementById("btn-extend-30"),
    btnExt60: document.getElementById("btn-extend-60"),
    btnEnd: document.getElementById("btn-end"),
    reveal: document.getElementById("reveal-toggle"),
    dashboardLink: document.getElementById("dashboard-link"),
    csvLink: document.getElementById("csv-link"),
    btnDelete: document.getElementById("btn-delete"),
    broadcastMsg: document.getElementById("broadcast-msg"),
    btnBroadcast: document.getElementById("btn-broadcast"),
    btnBroadcastClear: document.getElementById("btn-broadcast-clear"),
    tWOut: document.getElementById("t-w-outside"),
    tG: document.getElementById("t-g"),
    tC: document.getElementById("t-c-effort"),
    tFire: document.getElementById("t-firing"),
    tuneStatus: document.getElementById("tune-status"),
    tuneFirmTypes: document.getElementById("tune-firm-types"),
    btnApply: document.getElementById("btn-apply-params"),
    roster: document.getElementById("roster"),
    firmsDetail: document.getElementById("firms-detail"),
    lookupInput: document.getElementById("lookup-input"),
    btnLookup: document.getElementById("btn-lookup"),
    btnLookupClear: document.getElementById("btn-lookup-clear"),
    btnLookupCsv: document.getElementById("btn-lookup-csv"),
    lookupResults: document.getElementById("lookup-results"),
    log: document.getElementById("status-log"),
  };
  const log = makeLogger(el.log);

  // Last-computed {id: token} mapping lives only in the browser.
  let lastLookup = null;

  const state = {
    adminKey: "",
    sessionCode: null,
    stream: null,
    latest: null,
  };

  // --- Admin key --------------------------------------------------------

  function loadKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
  }
  function storeKey(v) {
    try { localStorage.setItem(KEY_STORAGE, v); } catch {}
  }
  function clearKey() {
    try { localStorage.removeItem(KEY_STORAGE); } catch {}
  }

  // --- Firm-type editors ------------------------------------------------

  function renderFirmTypeEditor(container, types) {
    container.innerHTML = types.map((ft, idx) => `
      <div class="card" style="display:grid; gap:0.6rem; margin-bottom:0.6rem;">
        <div class="panel-header" style="margin-bottom:0;"><h4 style="margin:0;">${escapeHtml(ft.label)}</h4><span class="badge muted">${escapeHtml(ft.key)}</span></div>
        <div class="grid four">
          <label><span>Count</span><input type="number" data-field="count" data-idx="${idx}" value="${ft.count}" min="0"></label>
          <label><span>Base wage</span><input type="number" data-field="base_wage" data-idx="${idx}" value="${ft.base_wage}" min="0"></label>
          <label><span>Monitoring (0–1)</span><input type="number" data-field="monitoring" data-idx="${idx}" value="${ft.monitoring}" min="0" max="1" step="0.05"></label>
          <label><span>Contract length N</span><input type="number" data-field="contract_length" data-idx="${idx}" value="${ft.contract_length}" min="1"></label>
        </div>
      </div>
    `).join("");
  }

  function readFirmTypes(container, source) {
    const next = source.map((ft) => ({ ...ft }));
    container.querySelectorAll("input[data-field]").forEach((inp) => {
      const idx = Number(inp.dataset.idx);
      const field = inp.dataset.field;
      const val = Number(inp.value);
      if (!next[idx]) return;
      next[idx][field] = val;
    });
    return next;
  }

  // --- Create flow ------------------------------------------------------

  async function createSession() {
    if (!state.adminKey) return toast("Enter your admin key first.", "error");
    const firms = readFirmTypes(el.firmTypes, DEFAULT_FIRM_TYPES);
    const params = {
      t_rounds: Number(el.tRounds.value),
      duration_auction: Number(el.dAuc.value),
      duration_effort: Number(el.dEff.value),
      duration_resolution: Number(el.dRes.value),
      w_outside: Number(el.wOut.value),
      g: Number(el.pG.value),
      c_effort: Number(el.pC.value),
      firing_penalty_rounds: Number(el.pFire.value),
      alpha: Number(el.alpha.value),
      beta: Number(el.beta.value),
      w_max_multiplier: Number(el.wmax.value),
      heterogeneous_g: el.heter.value === "true",
      g_spread: Number(el.spread.value),
      firm_types: firms,
    };
    try {
      const res = await adminApi("/api/session", state.adminKey, {
        method: "POST", body: { params },
      });
      toast(`Created session ${res.session.code}`, "ok");
      log(`Created session ${res.session.code}`);
      attachSession(res.session.code);
      refreshSessionList();
    } catch (exc) {
      toast(exc.message, "error");
      log(`Create failed: ${exc.message}`);
    }
  }

  // --- Session list -----------------------------------------------------

  async function refreshSessionList() {
    if (!state.adminKey) {
      el.sessionsList.innerHTML = `<p class="hint">Save your admin key, then press Refresh.</p>`;
      return;
    }
    try {
      const res = await adminApi("/api/admin/sessions", state.adminKey);
      if (!res.sessions.length) {
        el.sessionsList.innerHTML = `<p class="empty">No sessions yet.</p>`;
        return;
      }
      el.sessionsList.innerHTML = `<table class="table"><thead><tr>
        <th>Code</th><th>Phase</th><th>Round</th><th>Created</th><th></th>
      </tr></thead><tbody>${res.sessions.map((s) => `<tr>
        <td><code>${escapeHtml(s.session.code)}</code></td>
        <td>${escapeHtml(s.session.phase)}</td>
        <td>${s.session.current_round} / ${s.session.t_rounds}</td>
        <td>${escapeHtml(new Date(s.created_at).toLocaleString())}</td>
        <td><button class="button" data-code="${escapeHtml(s.session.code)}">Open</button></td>
      </tr>`).join("")}</tbody></table>`;
      el.sessionsList.querySelectorAll("button[data-code]").forEach((btn) => {
        btn.addEventListener("click", () => attachSession(btn.dataset.code));
      });
    } catch (exc) {
      el.sessionsList.innerHTML = `<p class="hint">Could not list sessions: ${escapeHtml(exc.message)}</p>`;
    }
  }

  // --- Attach ------------------------------------------------------------

  function attachSession(code) {
    state.sessionCode = code;
    try { localStorage.setItem(ACTIVE_STORAGE, code); } catch {}
    el.controlPanel.hidden = false;
    el.activeCode.textContent = code;
    el.dashboardLink.href = `./dashboard.html?code=${encodeURIComponent(code)}`;
    el.csvLink.href = `${API_BASE.replace(/\/$/, "")}/api/session/${encodeURIComponent(code)}/csv`;
    if (state.stream) state.stream.close();
    state.stream = connectStream(code, () => refreshAdminSnapshot());
    refreshAdminSnapshot();
  }

  function detachSession() {
    state.sessionCode = null;
    try { localStorage.removeItem(ACTIVE_STORAGE); } catch {}
    if (state.stream) { state.stream.close(); state.stream = null; }
    el.controlPanel.hidden = true;
  }

  async function refreshAdminSnapshot() {
    if (!state.sessionCode || !state.adminKey) return;
    try {
      const snap = await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}/admin`,
        state.adminKey,
      );
      state.latest = snap;
      applySnapshot(snap);
    } catch (exc) {
      log(`Snapshot error: ${exc.message}`);
    }
  }

  function applySnapshot(snap) {
    const { session, students, phase_counts, applicants_per_firm,
      firms_detail, params, pending_params, broadcast, leaderboard } = snap;
    el.activePhase.textContent = session.paused ? "paused" : session.phase;
    el.activePhase.className = session.paused ? "badge warn" : "badge";
    el.activeRound.textContent = `Round ${session.current_round} of ${session.t_rounds}`;
    const left = snap.phase_seconds_left;
    el.activeTimer.textContent = left == null ? "—"
      : session.paused ? `paused · ${Math.round(left)}s left` : `${Math.round(left)}s`;

    el.mStudents.textContent = snap.student_count;
    el.mEmployed.textContent = phase_counts.employed || 0;
    el.mBackup.textContent = (phase_counts.backup || 0) + (phase_counts.sitting_out || 0);
    el.mCaught.textContent = snap.caught_this_round || 0;

    el.btnStart.hidden = session.phase !== "lobby";
    el.btnAdvance.disabled = session.phase === "lobby" || session.phase === "ended";
    el.btnPause.hidden = session.paused || session.phase === "lobby" || session.phase === "ended";
    el.btnResume.hidden = !session.paused;
    el.btnEnd.hidden = session.phase !== "ended";
    el.reveal.checked = !!session.reveal_on;

    if (broadcast && broadcast.message) el.broadcastMsg.value = broadcast.message;

    // Param form sync (tune panel)
    const tunedParams = pending_params || params;
    el.tWOut.value = tunedParams.w_outside;
    el.tG.value = tunedParams.g;
    el.tC.value = tunedParams.c_effort;
    el.tFire.value = tunedParams.firing_penalty_rounds;
    renderFirmTypeEditor(el.tuneFirmTypes, tunedParams.firm_types || DEFAULT_FIRM_TYPES);
    el.tuneStatus.textContent = pending_params
      ? `Queued for round ${session.current_round + 1}. The current round keeps using the active settings.`
      : session.phase === "lobby"
        ? "Changes apply immediately before the session starts."
        : "Changes made here will be queued for the next round.";

    // Roster
    if (!students || !students.length) {
      el.roster.innerHTML = `<p class="empty">No students have joined yet.</p>`;
    } else {
      const rows = students.slice().sort((a, b) => b.cumulative_earnings - a.cumulative_earnings);
      el.roster.innerHTML = `<table class="table"><thead><tr>
          <th>#</th><th>Name</th><th>Token</th><th>Status</th><th>Cumulative</th>
          <th>This round</th><th>Earnings</th><th>Caught?</th><th>Firing left</th>
        </tr></thead><tbody>${rows.map((st, i) => `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(st.display_name)}</td>
          <td><code>${escapeHtml(st.token)}</code></td>
          <td>${escapeHtml(st.status)}</td>
          <td>${fmtMoney(st.cumulative_earnings)}</td>
          <td>${escapeHtml(st.current_firm_label || "—")}</td>
          <td>${fmtMoney(st.current_earnings)}</td>
          <td>${st.current_caught === 1 ? "<span class=\"badge danger\">caught</span>" : st.current_caught === 0 ? "no" : "—"}</td>
          <td>${st.firing_penalty_remaining}</td>
        </tr>`).join("")}</tbody></table>`;
    }

    // Refresh the lookup table so "Joined as" and earnings stay current.
    if (lastLookup && lastLookup.length) renderLookup();

    // Firms detail (aggregate by type)
    if (applicants_per_firm && applicants_per_firm.length) {
      el.firmsDetail.innerHTML = `<table class="table"><thead><tr>
          <th>Firm type</th><th>Slots filled</th><th>Current wage</th>
        </tr></thead><tbody>${applicants_per_firm.map((f) => `<tr>
          <td>${escapeHtml(f.firm_label)}</td>
          <td>${f.filled} / ${f.total}</td>
          <td>${fmtMoney(f.current_wage)}</td>
        </tr>`).join("")}</tbody></table>`;
    } else {
      el.firmsDetail.innerHTML = `<p class="empty">Firms appear after the session is created.</p>`;
    }
  }

  // --- Actions ----------------------------------------------------------

  async function doAction(action) {
    if (!state.sessionCode || !state.adminKey) return;
    try {
      await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}/${action}`,
        state.adminKey,
        { method: "POST", body: {} },
      );
      log(`${action} → ok`);
      refreshAdminSnapshot();
    } catch (exc) {
      toast(exc.message, "error");
      log(`${action} failed: ${exc.message}`);
    }
  }

  async function doExtend(seconds) {
    if (!state.sessionCode || !state.adminKey) return;
    try {
      await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}/extend`,
        state.adminKey,
        { method: "POST", body: { seconds } },
      );
      log(`extend +${seconds}s`);
      refreshAdminSnapshot();
    } catch (exc) {
      toast(exc.message, "error");
    }
  }

  async function doBroadcast(clear) {
    if (!state.sessionCode || !state.adminKey) return;
    const message = clear ? "" : el.broadcastMsg.value;
    try {
      await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}/broadcast`,
        state.adminKey,
        { method: "POST", body: { message } },
      );
      toast(clear ? "Broadcast cleared." : "Broadcast sent.");
      if (clear) el.broadcastMsg.value = "";
    } catch (exc) {
      toast(exc.message, "error");
    }
  }

  async function doReveal() {
    if (!state.sessionCode || !state.adminKey) return;
    try {
      await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}/reveal`,
        state.adminKey,
        { method: "POST", body: { on: el.reveal.checked } },
      );
    } catch (exc) {
      toast(exc.message, "error");
    }
  }

  async function doApplyParams() {
    if (!state.sessionCode || !state.adminKey) return;
    const currentParams = (state.latest && (state.latest.pending_params || state.latest.params))
      ? (state.latest.pending_params || state.latest.params) : null;
    const currentFirms = currentParams && currentParams.firm_types
      ? currentParams.firm_types : DEFAULT_FIRM_TYPES;
    const firmTypes = readFirmTypes(el.tuneFirmTypes, currentFirms);
    const patch = {
      w_outside: Number(el.tWOut.value),
      g: Number(el.tG.value),
      c_effort: Number(el.tC.value),
      firing_penalty_rounds: Number(el.tFire.value),
      firm_types: firmTypes,
    };
    try {
      const res = await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}/params`,
        state.adminKey,
        { method: "POST", body: { params: patch } },
      );
      toast(res.staged ? "Changes queued for the next round." : "Parameters applied.");
      refreshAdminSnapshot();
    } catch (exc) {
      toast(exc.message, "error");
    }
  }

  function parseLookupInput(raw) {
    if (!raw) return [];
    const seen = new Set();
    const out = [];
    for (const piece of raw.split(/[\s,;]+/)) {
      const id = piece.trim().toUpperCase();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  async function doLookup() {
    if (!state.sessionCode || !state.adminKey) {
      return toast("Attach a session and enter your admin key first.", "error");
    }
    const ids = parseLookupInput(el.lookupInput.value);
    if (!ids.length) {
      return toast("Paste at least one faculty ID.", "error");
    }
    try {
      const res = await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}/tokenize`,
        state.adminKey,
        { method: "POST", body: { ids } },
      );
      const mapping = res.mapping || {};
      lastLookup = ids.map((id) => ({ id, token: mapping[id] || null }));
      renderLookup();
      toast(`Resolved ${Object.keys(mapping).length} of ${ids.length} IDs.`);
    } catch (exc) {
      toast(exc.message, "error");
    }
  }

  function renderLookup() {
    if (!lastLookup || !lastLookup.length) {
      el.lookupResults.innerHTML = "";
      return;
    }
    const joinedStudents = (state.latest && state.latest.students) || [];
    const byToken = new Map();
    for (const st of joinedStudents) byToken.set(st.token, st);
    el.lookupResults.innerHTML = `<table class="table"><thead><tr>
        <th>Faculty ID</th><th>Token</th><th>Joined as</th><th>Cumulative</th>
      </tr></thead><tbody>${lastLookup.map((row) => {
        const joined = row.token ? byToken.get(row.token) : null;
        return `<tr>
          <td><code>${escapeHtml(row.id)}</code></td>
          <td>${row.token ? `<code>${escapeHtml(row.token)}</code>` : "<span class=\"muted-text\">invalid</span>"}</td>
          <td>${joined ? escapeHtml(joined.display_name) : "<span class=\"muted-text\">not joined</span>"}</td>
          <td>${joined ? fmtMoney(joined.cumulative_earnings) : "—"}</td>
        </tr>`;
      }).join("")}</tbody></table>`;
  }

  function downloadLookupCsv() {
    if (!lastLookup || !lastLookup.length) {
      return toast("Compute tokens first.", "error");
    }
    const joinedStudents = (state.latest && state.latest.students) || [];
    const byToken = new Map();
    for (const st of joinedStudents) byToken.set(st.token, st);
    const header = ["faculty_id", "token", "display_name", "cumulative_earnings"];
    const lines = [header.join(",")];
    for (const row of lastLookup) {
      const joined = row.token ? byToken.get(row.token) : null;
      const cells = [
        row.id,
        row.token || "",
        joined ? joined.display_name : "",
        joined ? String(joined.cumulative_earnings) : "",
      ].map((v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
      });
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labor-session-${state.sessionCode}-roster.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function doDelete() {
    if (!state.sessionCode || !state.adminKey) return;
    if (!confirm(`Delete session ${state.sessionCode}? This is irreversible.`)) return;
    try {
      await adminApi(
        `/api/session/${encodeURIComponent(state.sessionCode)}`,
        state.adminKey,
        { method: "DELETE" },
      );
      toast("Session deleted.");
      detachSession();
      refreshSessionList();
    } catch (exc) {
      toast(exc.message, "error");
    }
  }

  // --- Wire up ----------------------------------------------------------

  function wire() {
    el.apiHost.textContent = API_BASE.replace(/^https?:\/\//, "");
    el.adminKey.value = loadKey();
    state.adminKey = el.adminKey.value;

    renderFirmTypeEditor(el.firmTypes, DEFAULT_FIRM_TYPES);

    el.adminKey.addEventListener("input", () => {
      state.adminKey = el.adminKey.value.trim();
    });
    el.saveKey.addEventListener("click", () => {
      storeKey(el.adminKey.value.trim());
      state.adminKey = el.adminKey.value.trim();
      toast("Admin key saved on this device.");
      refreshSessionList();
    });
    el.forgetKey.addEventListener("click", () => {
      clearKey();
      el.adminKey.value = "";
      state.adminKey = "";
      toast("Admin key forgotten.");
    });
    el.refreshList.addEventListener("click", refreshSessionList);
    el.createBtn.addEventListener("click", createSession);

    el.btnStart.addEventListener("click", () => doAction("start"));
    el.btnAdvance.addEventListener("click", () => doAction("advance"));
    el.btnPause.addEventListener("click", () => doAction("pause"));
    el.btnResume.addEventListener("click", () => doAction("resume"));
    el.btnExt10.addEventListener("click", () => doExtend(10));
    el.btnExt30.addEventListener("click", () => doExtend(30));
    el.btnExt60.addEventListener("click", () => doExtend(60));
    el.btnDelete.addEventListener("click", doDelete);
    el.btnBroadcast.addEventListener("click", () => doBroadcast(false));
    el.btnBroadcastClear.addEventListener("click", () => doBroadcast(true));
    el.reveal.addEventListener("change", doReveal);
    el.btnApply.addEventListener("click", doApplyParams);
    el.btnLookup.addEventListener("click", doLookup);
    el.btnLookupClear.addEventListener("click", () => {
      el.lookupInput.value = "";
      lastLookup = null;
      renderLookup();
    });
    el.btnLookupCsv.addEventListener("click", downloadLookupCsv);

    // Resume if we remembered a session.
    try {
      const saved = localStorage.getItem(ACTIVE_STORAGE);
      if (saved && state.adminKey) {
        attachSession(saved);
      }
    } catch {}
    refreshSessionList();
  }

  wire();
}());
