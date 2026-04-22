(function () {
  const {
    escapeHtml, publicApi, fmtMoney, fmtPercent, phaseLabel,
    connectStream, drawLineChart, FIRM_COLORS,
  } = window.LaborShared;

  const el = {
    connectPanel: document.getElementById("connect-panel"),
    connectForm: document.getElementById("connect-form"),
    fieldCode: document.getElementById("field-code"),
    projection: document.getElementById("projection"),
    sessionCode: document.getElementById("session-code"),
    sessionPhase: document.getElementById("session-phase"),
    sessionRound: document.getElementById("session-round"),
    sessionTimer: document.getElementById("session-timer"),
    broadcast: document.getElementById("broadcast-banner"),
    chartWage: document.getElementById("chart-wage"),
    wageLegend: document.getElementById("wage-legend"),
    chartShirk: document.getElementById("chart-shirk"),
    chartUnemp: document.getElementById("chart-unemp"),
    mEmployed: document.getElementById("m-employed"),
    mBackup: document.getElementById("m-backup"),
    mSitting: document.getElementById("m-sitting"),
    mCaught: document.getElementById("m-caught"),
    firmsList: document.getElementById("firms-list"),
    leaderboard: document.getElementById("leaderboard"),
    lbCount: document.getElementById("lb-count"),
    revealPanel: document.getElementById("reveal-panel"),
    revealBody: document.getElementById("reveal-body"),
  };

  const state = { code: null, stream: null, latest: null };

  function firmLabelColor(firmType) {
    return FIRM_COLORS[firmType] || "#687277";
  }

  async function refresh() {
    if (!state.code) return;
    try {
      const snap = await publicApi(`/api/session/${encodeURIComponent(state.code)}/dashboard`);
      state.latest = snap;
      render(snap);
    } catch (exc) {
      console.warn("Dashboard fetch:", exc);
    }
  }

  function render(snap) {
    if (!snap || !snap.session) return;
    el.sessionCode.textContent = snap.session.code;
    el.sessionPhase.textContent = snap.session.paused
      ? `Paused — ${phaseLabel(snap.session.phase)}`
      : phaseLabel(snap.session.phase);
    el.sessionRound.textContent = `${snap.session.current_round}/${snap.session.t_rounds}`;
    const left = snap.phase_seconds_left;
    el.sessionTimer.textContent = left == null ? "—" : `${Math.round(left)}s left`;

    const pc = snap.phase_counts || {};
    el.mEmployed.textContent = pc.employed || 0;
    el.mBackup.textContent = pc.backup || 0;
    el.mSitting.textContent = pc.sitting_out || 0;
    el.mCaught.textContent = snap.caught_this_round || 0;

    // Broadcast
    if (snap.broadcast && snap.broadcast.message) {
      el.broadcast.hidden = false;
      el.broadcast.textContent = snap.broadcast.message;
    } else {
      el.broadcast.hidden = true;
    }

    // Firms list
    const fa = snap.applicants_per_firm || [];
    if (fa.length) {
      el.firmsList.innerHTML = `<table class="table"><thead><tr>
          <th>Firm</th><th>Wage</th><th>Filled</th>
        </tr></thead><tbody>${fa.map((f) => `<tr>
          <td><span style="display:inline-block; width:8px; height:8px; background:${firmLabelColor(f.firm_type)}; border-radius:2px; margin-right:6px;"></span>${escapeHtml(f.firm_label)}</td>
          <td>${fmtMoney(f.current_wage)}</td>
          <td>${f.filled} / ${f.total}</td>
        </tr>`).join("")}</tbody></table>`;
    } else {
      el.firmsList.innerHTML = `<p class="empty">No firms yet.</p>`;
    }

    // Leaderboard
    const lb = snap.leaderboard || [];
    el.lbCount.textContent = `top ${lb.length}`;
    if (lb.length) {
      el.leaderboard.innerHTML = `<table class="table"><thead><tr>
          <th>#</th><th>Name</th><th>Total</th>
        </tr></thead><tbody>${lb.map((row, i) => `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(row.display_name)}</td>
          <td>${fmtMoney(row.cumulative_earnings)}</td>
        </tr>`).join("")}</tbody></table>`;
    } else {
      el.leaderboard.innerHTML = `<p class="empty">Nobody has earned yet.</p>`;
    }

    // Reveal panel
    if (snap.reveal_on && snap.params) {
      el.revealPanel.hidden = false;
      const p = snap.params;
      const firms = (p.firm_types || []).map((ft) => `<tr>
          <td>${escapeHtml(ft.label)}</td>
          <td>${ft.count}</td>
          <td>${fmtMoney(ft.base_wage)}</td>
          <td>${ft.monitoring}</td>
          <td>${ft.contract_length}</td>
        </tr>`).join("");
      el.revealBody.innerHTML = `
        <div class="summary-grid" style="grid-template-columns: repeat(2, 1fr); gap:0.5rem;">
          <div class="summary-box"><span class="muted-text">Backup wage ŵ</span><strong>${fmtMoney(p.w_outside)}</strong></div>
          <div class="summary-box"><span class="muted-text">Shirk bonus g</span><strong>${fmtMoney(p.g)}</strong></div>
          <div class="summary-box"><span class="muted-text">Effort cost c</span><strong>${fmtMoney(p.c_effort)}</strong></div>
          <div class="summary-box"><span class="muted-text">Firing penalty</span><strong>${p.firing_penalty_rounds} round(s)</strong></div>
        </div>
        <h4 style="margin-top:0.8rem;">Firm types</h4>
        <table class="table"><thead><tr>
          <th>Type</th><th>Count</th><th>Base wage</th><th>Monitoring p</th><th>Contract N</th>
        </tr></thead><tbody>${firms}</tbody></table>
        <p class="hint" style="margin-top:0.8rem;">
          The textbook no-shirking condition: a worker stays honest when
          <code>g ≤ p · (w − ŵ) · N</code>. This is what the class just lived through.
        </p>`;
    } else {
      el.revealPanel.hidden = true;
    }

    drawCharts(snap);
  }

  function drawCharts(snap) {
    // Wage chart: one line per firm type + overall average
    const wageSeries = snap.wage_series || [];
    const types = new Map();
    for (const row of wageSeries) {
      if (!types.has(row.firm_type)) types.set(row.firm_type, []);
      types.get(row.firm_type).push({ x: row.round, y: row.avg_wage });
    }
    const overall = (snap.round_meta || []).map((r) => ({ x: r.round, y: r.avg_wage }));
    const wageChartSeries = [];
    for (const [type, data] of types.entries()) {
      wageChartSeries.push({
        color: firmLabelColor(type),
        label: type,
        data,
      });
    }
    if (overall.length) {
      wageChartSeries.push({
        color: FIRM_COLORS.overall,
        label: "all firms",
        data: overall,
      });
    }
    drawLineChart(el.chartWage, wageChartSeries, { yMin: 0 });

    // Legend for wage chart
    const seen = new Set();
    el.wageLegend.innerHTML = wageChartSeries.map((s) => {
      if (seen.has(s.label)) return "";
      seen.add(s.label);
      return `<span><span class="dot" style="background:${s.color};"></span>${escapeHtml(s.label)}</span>`;
    }).join("");

    // Shirk chart
    const shirkSeries = [{
      color: FIRM_COLORS.big,
      label: "shirk rate",
      data: (snap.round_meta || []).map((r) => ({ x: r.round, y: r.shirk_rate })),
    }];
    drawLineChart(el.chartShirk, shirkSeries, {
      yMin: 0, yMax: 1,
      yFormat: (v) => `${Math.round(v * 100)}%`,
    });

    // Unemployment chart
    const unempSeries = [{
      color: FIRM_COLORS.small,
      label: "unemployed",
      data: (snap.round_meta || []).map((r) => ({ x: r.round, y: r.unemployment_rate })),
    }];
    drawLineChart(el.chartUnemp, unempSeries, {
      yMin: 0, yMax: 1,
      yFormat: (v) => `${Math.round(v * 100)}%`,
    });
  }

  function attach(code) {
    state.code = code.toUpperCase();
    if (state.stream) state.stream.close();
    state.stream = connectStream(state.code, () => refresh());
    el.connectPanel.hidden = true;
    el.projection.hidden = false;
    const url = new URL(window.location.href);
    url.searchParams.set("code", state.code);
    window.history.replaceState(null, "", url.toString());
    refresh();
  }

  function wire() {
    el.connectForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const code = el.fieldCode.value.trim().toUpperCase();
      if (!code) return;
      attach(code);
    });
    el.fieldCode.addEventListener("input", () => {
      el.fieldCode.value = el.fieldCode.value.toUpperCase();
    });

    // Accept ?code=...
    const url = new URL(window.location.href);
    const presetCode = url.searchParams.get("code");
    if (presetCode) {
      el.fieldCode.value = presetCode.toUpperCase();
      attach(presetCode);
    }
    // Redraw charts on resize.
    window.addEventListener("resize", () => state.latest && drawCharts(state.latest));
  }

  wire();
}());
