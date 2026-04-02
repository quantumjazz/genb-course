(function () {
  const {
    adminApi,
    createLogger,
    escapeHtml,
    filterRows,
    formatDate,
    orderedText,
    parseOrderedIds,
    phaseLabel,
    publicApi,
    renderTable,
    roleLabel,
    setBadge,
    slugify,
    summaryBox,
  } = window.MatchingShared;

  const elements = {
    adminKey: document.getElementById("admin-key"),
    connectionBadge: document.getElementById("connection-badge"),
    adminBadge: document.getElementById("admin-badge"),
    marketSummary: document.getElementById("market-summary"),
    adminSummary: document.getElementById("admin-summary"),
    openRegistration: document.getElementById("open-registration"),
    openRanking: document.getElementById("open-ranking"),
    lockMarket: document.getElementById("lock-market"),
    loadDemo: document.getElementById("load-demo"),
    runHospital: document.getElementById("run-hospital"),
    runCandidate: document.getElementById("run-candidate"),
    publishLatestRun: document.getElementById("publish-latest-run"),
    resetMarket: document.getElementById("reset-market"),
    hospitalSubmissionFilter: document.getElementById("hospital-submission-filter"),
    candidateSubmissionFilter: document.getElementById("candidate-submission-filter"),
    hospitalSubmissionTable: document.getElementById("hospital-submission-table"),
    candidateSubmissionTable: document.getElementById("candidate-submission-table"),
    publicationBadge: document.getElementById("publication-badge"),
    stabilityBadge: document.getElementById("stability-badge"),
    hospitalTable: document.getElementById("hospital-table"),
    candidateTable: document.getElementById("candidate-table"),
    hospitalRankings: document.getElementById("hospital-rankings"),
    candidateRankings: document.getElementById("candidate-rankings"),
    snapshot: document.getElementById("snapshot"),
    runSummary: document.getElementById("run-summary"),
    matchesFilter: document.getElementById("matches-filter"),
    matchesTable: document.getElementById("matches-table"),
    blockingPairs: document.getElementById("blocking-pairs"),
    traceTable: document.getElementById("trace-table"),
    statusLog: document.getElementById("status-log"),
    hospitalForm: document.getElementById("hospital-form"),
    candidateForm: document.getElementById("candidate-form"),
    hospitalId: document.getElementById("hospital-id"),
    hospitalName: document.getElementById("hospital-name"),
    hospitalCapacity: document.getElementById("hospital-capacity"),
    candidateId: document.getElementById("candidate-id"),
    candidateName: document.getElementById("candidate-name"),
    unlockAdmin: document.getElementById("unlock-admin"),
    lockAdmin: document.getElementById("lock-admin"),
    checkConnection: document.getElementById("check-connection"),
    refreshState: document.getElementById("refresh-state"),
    adminSections: Array.from(document.querySelectorAll(".admin-only")),
  };

  const state = {
    publicMarket: null,
    adminData: null,
  };

  const log = createLogger(elements.statusLog);

  function getRankingLimit() {
    return state.adminData?.rankingLimit || state.publicMarket?.rankingLimit || 10;
  }

  function renderConnectionBadges() {
    if (state.publicMarket) {
      setBadge(elements.connectionBadge, "Public API reachable", "ok");
    } else {
      setBadge(elements.connectionBadge, "Public API unavailable", "warn");
    }

    if (state.adminData) {
      setBadge(elements.adminBadge, "Admin panel unlocked", "ok");
    } else if (elements.adminKey.value.trim()) {
      setBadge(elements.adminBadge, "Admin key rejected or missing", "warn");
    } else {
      setBadge(elements.adminBadge, "Admin locked", "muted");
    }
  }

  function renderAdminVisibility() {
    const unlocked = Boolean(state.adminData);
    elements.adminSections.forEach((section) => {
      section.hidden = !unlocked;
    });
  }

  function renderAdminSummary() {
    if (!state.adminData) {
      setBadge(elements.marketSummary, "Admin state unavailable", "muted");
      elements.adminSummary.innerHTML = [
        summaryBox("Admin access", "Unavailable"),
        summaryBox("Phase", "Unknown"),
        summaryBox("Public market", state.publicMarket ? "Loaded" : "Unavailable"),
        summaryBox("Published result", "Unavailable"),
      ].join("");
      return;
    }

    const hospitals = state.adminData.hospitals || [];
    const candidates = state.adminData.candidates || [];
    const counts = state.adminData.submissionSummary.counts;
    const slotCount = hospitals.reduce((sum, hospital) => sum + Number(hospital.capacity || 0), 0);
    const phase = state.adminData.phase;
    const publishedRun = state.adminData.publishedRun;

    setBadge(
      elements.marketSummary,
      `${phaseLabel(phase)} · ${hospitals.length} hospitals · ${candidates.length} students · ${slotCount} slots`,
      "",
    );
    elements.adminSummary.innerHTML = [
      summaryBox("Phase", phaseLabel(phase)),
      summaryBox("Hospitals submitted", `${counts.hospitalsSubmitted}/${counts.hospitalsTotal}`),
      summaryBox("Students submitted", `${counts.candidatesSubmitted}/${counts.candidatesTotal}`),
      summaryBox(
        "Published result",
        publishedRun
          ? `${roleLabel(publishedRun.proposerSide)} · ${formatDate(publishedRun.createdAt, "n/a")}`
          : "Not published",
      ),
    ].join("");

    elements.openRegistration.disabled = phase === "registration_open";
    elements.openRanking.disabled = phase === "ranking_open";
    elements.lockMarket.disabled = phase === "locked";
    elements.runHospital.disabled = phase !== "locked";
    elements.runCandidate.disabled = phase !== "locked";
  }

  function renderSubmissionStatus() {
    if (!state.adminData) {
      elements.hospitalSubmissionTable.innerHTML = `<p class="empty">Unlock admin to see hospital submission status.</p>`;
      elements.candidateSubmissionTable.innerHTML = `<p class="empty">Unlock admin to see student submission status.</p>`;
      return;
    }

    const hospitals = filterRows(
      state.adminData.submissionSummary.hospitals,
      elements.hospitalSubmissionFilter.value,
      [
        (row) => row.name,
        (row) => row.id,
        (row) => row.source || "",
      ],
    );
    const candidates = filterRows(
      state.adminData.submissionSummary.candidates,
      elements.candidateSubmissionFilter.value,
      [
        (row) => row.name,
        (row) => row.id,
        (row) => row.source || "",
      ],
    );

    elements.hospitalSubmissionTable.innerHTML = renderTable(
      [
        { label: "Hospital", render: (row) => `${row.name} (${row.id})` },
        { label: "Ranking", render: (row) => `${row.rankingCount}/${Math.min(row.requiredCount, getRankingLimit())}` },
        { label: "Submitted", render: (row) => (row.submitted ? "Yes" : "No") },
        { label: "Updated", render: (row) => formatDate(row.submittedAt) },
        { label: "Source", render: (row) => row.source || "—" },
      ],
      hospitals,
    );

    elements.candidateSubmissionTable.innerHTML = renderTable(
      [
        { label: "Student", render: (row) => `${row.name} (${row.id})` },
        { label: "Ranking", render: (row) => `${row.rankingCount}/${Math.min(row.requiredCount, getRankingLimit())}` },
        { label: "Submitted", render: (row) => (row.submitted ? "Yes" : "No") },
        { label: "Updated", render: (row) => formatDate(row.submittedAt) },
        { label: "Source", render: (row) => row.source || "—" },
      ],
      candidates,
    );
  }

  function renderEntities() {
    const hospitals = state.adminData?.hospitals || [];
    const candidates = state.adminData?.candidates || [];

    elements.hospitalTable.innerHTML = renderTable(
      [
        { label: "ID", key: "id" },
        { label: "Name", key: "name" },
        { label: "Capacity", key: "capacity" },
        {
          label: "Actions",
          html: true,
          render: (row) => `<button class="button danger-inline" data-remove-role="hospital" data-role-id="${escapeHtml(row.id)}" data-role-label="${escapeHtml(row.name)}">Remove</button>`,
        },
      ],
      hospitals,
    );

    elements.candidateTable.innerHTML = renderTable(
      [
        { label: "ID", key: "id" },
        { label: "Name", key: "name" },
        {
          label: "Actions",
          html: true,
          render: (row) => `<button class="button danger-inline" data-remove-role="candidate" data-role-id="${escapeHtml(row.id)}" data-role-label="${escapeHtml(row.name)}">Remove</button>`,
        },
      ],
      candidates,
    );
  }

  function renderRankingEditors() {
    const hospitals = state.adminData?.hospitals || [];
    const candidates = state.adminData?.candidates || [];
    const hospitalRankings = state.adminData?.hospitalRankings || {};
    const candidateRankings = state.adminData?.candidateRankings || {};

    if (!state.adminData) {
      elements.hospitalRankings.innerHTML = `<p class="empty">Unlock admin for manual ranking overrides.</p>`;
      elements.candidateRankings.innerHTML = `<p class="empty">Unlock admin for manual ranking overrides.</p>`;
      return;
    }

    elements.hospitalRankings.innerHTML = hospitals.length
      ? hospitals
          .map(
            (hospital) => `
              <div class="ranking-card">
                <h4>${escapeHtml(hospital.name)} <span class="muted-text">(${escapeHtml(hospital.id)})</span></h4>
                <p class="ranking-meta">Student IDs in descending order. Available: ${escapeHtml(candidates.map((candidate) => candidate.id).join(", ") || "none")}.</p>
                <textarea data-ranking-type="hospital" data-entity-id="${escapeHtml(hospital.id)}">${escapeHtml(orderedText(hospitalRankings[hospital.id] || []))}</textarea>
                <div class="actions">
                  <button class="button primary" data-save-ranking="hospital" data-entity-id="${escapeHtml(hospital.id)}">Save ranking</button>
                </div>
              </div>
            `,
          )
          .join("")
      : `<p class="empty">Add at least one hospital first.</p>`;

    elements.candidateRankings.innerHTML = candidates.length
      ? candidates
          .map(
            (candidate) => `
              <div class="ranking-card">
                <h4>${escapeHtml(candidate.name)} <span class="muted-text">(${escapeHtml(candidate.id)})</span></h4>
                <p class="ranking-meta">Hospital IDs in descending order. Available: ${escapeHtml(hospitals.map((hospital) => hospital.id).join(", ") || "none")}.</p>
                <textarea data-ranking-type="candidate" data-entity-id="${escapeHtml(candidate.id)}">${escapeHtml(orderedText(candidateRankings[candidate.id] || []))}</textarea>
                <div class="actions">
                  <button class="button primary" data-save-ranking="candidate" data-entity-id="${escapeHtml(candidate.id)}">Save ranking</button>
                </div>
              </div>
            `,
          )
          .join("")
      : `<p class="empty">Add at least one student first.</p>`;
  }

  function renderSnapshot() {
    if (!state.adminData) {
      elements.snapshot.value = "";
      return;
    }
    elements.snapshot.value = JSON.stringify(
      {
        phase: state.adminData.phase,
        hospitals: state.adminData.hospitals,
        candidates: state.adminData.candidates,
        hospitalRankings: state.adminData.hospitalRankings,
        candidateRankings: state.adminData.candidateRankings,
      },
      null,
      2,
    );
  }

  function renderRun() {
    const publishedRun = state.adminData?.publishedRun;
    const run = state.adminData?.latestRun;
    const publicResultText = publishedRun
      ? `${roleLabel(publishedRun.proposerSide)} · ${formatDate(publishedRun.createdAt, "n/a")}`
      : "Not published";

    if (!run) {
      elements.runSummary.innerHTML = [
        summaryBox("Latest run", "None yet"),
        summaryBox("Public result", publicResultText),
        summaryBox("Proposer side", "n/a"),
        summaryBox("Stable", "n/a"),
      ].join("");
      elements.matchesTable.innerHTML = `<p class="empty">Lock the market and run the algorithm to see assignments.</p>`;
      elements.blockingPairs.innerHTML = `<p class="empty">No run yet.</p>`;
      elements.traceTable.innerHTML = `<p class="empty">No trace yet.</p>`;
      setBadge(elements.stabilityBadge, "No run yet", "muted");
      setBadge(
        elements.publicationBadge,
        publishedRun ? "Published result points to an older run" : "No result published",
        publishedRun ? "warn" : "muted",
      );
      elements.publishLatestRun.disabled = true;
      return;
    }

    const stats = run.stats;
    const hospitalsById = Object.fromEntries(state.adminData.hospitals.map((hospital) => [hospital.id, hospital]));
    const candidatesById = Object.fromEntries(state.adminData.candidates.map((candidate) => [candidate.id, candidate]));
    const latestIsPublished = Boolean(publishedRun && publishedRun.id === run.id);
    const unfilteredMatchRows = Object.entries(run.hospitalMatches).map(([hospitalId, matchedIds]) => ({
      hospitalId,
      hospital: hospitalsById[hospitalId]?.name || hospitalId,
      capacity: hospitalsById[hospitalId]?.capacity ?? 0,
      matches: matchedIds.map((candidateId) => candidatesById[candidateId]?.name || candidateId).join(", ") || "Unfilled",
    }));
    const matchRows = filterRows(
      unfilteredMatchRows,
      elements.matchesFilter.value,
      [
        (row) => row.hospital,
        (row) => row.hospitalId,
        (row) => row.matches,
      ],
    );

    elements.runSummary.innerHTML = [
      summaryBox("Proposer side", roleLabel(run.proposerSide)),
      summaryBox("Matched pairs", `${stats.matchedCount}/${Math.min(stats.candidateCount, stats.totalSlots)}`),
      summaryBox("Student avg. rank", stats.averageCandidateRank ?? "n/a"),
      summaryBox("Hospital avg. rank", stats.averageHospitalRank ?? "n/a"),
      summaryBox("Blocking pairs", stats.blockingPairs.length),
      summaryBox("Public result", publicResultText),
      summaryBox("Created at", formatDate(run.createdAt, "n/a")),
    ].join("");

    setBadge(elements.stabilityBadge, stats.isStable ? "Stable" : "Blocking pairs found", stats.isStable ? "ok" : "warn");
    if (!publishedRun) {
      setBadge(elements.publicationBadge, "No result published", "muted");
    } else if (latestIsPublished) {
      setBadge(elements.publicationBadge, "Latest run is public", "ok");
    } else {
      setBadge(elements.publicationBadge, "Different run is public", "warn");
    }
    elements.publishLatestRun.disabled = state.adminData.phase !== "locked";

    elements.matchesTable.innerHTML = renderTable(
      [
        { label: "Hospital", key: "hospital" },
        { label: "Capacity", key: "capacity" },
        { label: "Matches", key: "matches" },
      ],
      matchRows,
    );

    if (!stats.blockingPairs.length) {
      elements.blockingPairs.innerHTML = `<p class="empty">No blocking pairs. This outcome is stable under the submitted rankings.</p>`;
    } else {
      elements.blockingPairs.innerHTML = renderTable(
        [
          { label: "Hospital", key: "hospitalName" },
          { label: "Student", key: "candidateName" },
        ],
        stats.blockingPairs,
      );
    }

    elements.traceTable.innerHTML = renderTable(
      [
        { label: "Step", key: "step" },
        { label: "Proposer", key: "proposerName" },
        { label: "Receiver", key: "receiverName" },
        { label: "Outcome", key: "outcomeLabel" },
        { label: "Displaced", render: (row) => row.displacedProposerName || "—" },
      ],
      run.trace,
    );
  }

  function renderAll() {
    renderConnectionBadges();
    renderAdminVisibility();
    renderAdminSummary();
    renderSubmissionStatus();
    renderEntities();
    renderRankingEditors();
    renderSnapshot();
    renderRun();
  }

  async function refreshPublicMarket({ quiet = false } = {}) {
    state.publicMarket = await publicApi("/api/public/market", { method: "GET" });
    if (!quiet) {
      log("Public market refreshed.");
    }
  }

  async function refreshAdminState({ quiet = false } = {}) {
    try {
      state.adminData = await adminApi("/api/state", elements.adminKey.value, { method: "GET" });
      if (!quiet) {
        log("Admin state refreshed.");
      }
    } catch (error) {
      state.adminData = null;
      if (!quiet && elements.adminKey.value.trim()) {
        log(error.message);
      }
    }
  }

  async function refreshAll({ quiet = false } = {}) {
    await refreshPublicMarket({ quiet: true });
    await refreshAdminState({ quiet: true });
    renderAll();
    if (!quiet) {
      log("Refreshed public and admin data.");
    }
  }

  async function adminMutate(path, body, successMessage) {
    await adminApi(path, elements.adminKey.value, {
      method: "POST",
      body: JSON.stringify(body || {}),
    });
    await refreshAll({ quiet: true });
    log(successMessage);
  }

  function attachHandlers() {
    elements.checkConnection.addEventListener("click", async () => {
      try {
        await refreshAll();
      } catch (error) {
        renderAll();
        log(error.message);
      }
    });

    elements.refreshState.addEventListener("click", async () => {
      try {
        await refreshAll();
      } catch (error) {
        renderAll();
        log(error.message);
      }
    });

    elements.unlockAdmin.addEventListener("click", async () => {
      try {
        await refreshAdminState();
        renderAll();
      } catch (error) {
        renderAll();
        log(error.message);
      }
    });

    elements.lockAdmin.addEventListener("click", () => {
      elements.adminKey.value = "";
      state.adminData = null;
      renderAll();
      log("Admin session cleared from this browser.");
    });

    elements.openRegistration.addEventListener("click", async () => {
      try {
        await adminMutate("/api/admin/market-phase", { phase: "registration_open" }, "Opened registration.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.openRanking.addEventListener("click", async () => {
      try {
        await adminMutate("/api/admin/market-phase", { phase: "ranking_open" }, "Opened ranking.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.lockMarket.addEventListener("click", async () => {
      try {
        await adminMutate("/api/admin/market-phase", { phase: "locked" }, "Locked the market.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.loadDemo.addEventListener("click", async () => {
      try {
        await adminMutate("/api/admin/load-demo", {}, "Loaded textbook demo market.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.runHospital.addEventListener("click", async () => {
      try {
        await adminMutate("/api/run", { proposerSide: "hospital" }, "Ran hospital-proposing deferred acceptance.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.runCandidate.addEventListener("click", async () => {
      try {
        await adminMutate("/api/run", { proposerSide: "candidate" }, "Ran student-proposing deferred acceptance.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.publishLatestRun.addEventListener("click", async () => {
      try {
        await adminMutate("/api/admin/publish-latest-run", {}, "Published the latest run.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.resetMarket.addEventListener("click", async () => {
      if (!window.confirm("Reset the entire market and clear all saved registrations, rankings, runs, and published results?")) {
        return;
      }
      try {
        await adminMutate("/api/admin/reset", {}, "Reset the market.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.hospitalName.addEventListener("input", () => {
      if (!elements.hospitalId.value.trim()) {
        elements.hospitalId.value = slugify(elements.hospitalName.value);
      }
    });

    elements.candidateName.addEventListener("input", () => {
      if (!elements.candidateId.value.trim()) {
        elements.candidateId.value = slugify(elements.candidateName.value);
      }
    });

    elements.hospitalForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await adminMutate(
          "/api/hospitals",
          {
            id: elements.hospitalId.value.trim(),
            name: elements.hospitalName.value.trim(),
            capacity: Number(elements.hospitalCapacity.value),
          },
          `Saved hospital '${elements.hospitalName.value.trim()}'.`,
        );
        elements.hospitalForm.reset();
        elements.hospitalCapacity.value = "1";
      } catch (error) {
        log(error.message);
      }
    });

    elements.candidateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await adminMutate(
          "/api/candidates",
          {
            id: elements.candidateId.value.trim(),
            name: elements.candidateName.value.trim(),
          },
          `Saved student '${elements.candidateName.value.trim()}'.`,
        );
        elements.candidateForm.reset();
      } catch (error) {
        log(error.message);
      }
    });

    document.getElementById("export-snapshot").addEventListener("click", () => {
      renderSnapshot();
      log("Exported current market snapshot into the editor.");
    });

    document.getElementById("import-snapshot").addEventListener("click", async () => {
      try {
        const payload = JSON.parse(elements.snapshot.value);
        await adminMutate("/api/import", payload, "Replaced market from snapshot.");
      } catch (error) {
        log(error.message);
      }
    });

    elements.hospitalSubmissionFilter.addEventListener("input", () => renderSubmissionStatus());
    elements.candidateSubmissionFilter.addEventListener("input", () => renderSubmissionStatus());
    elements.matchesFilter.addEventListener("input", () => renderRun());

    document.body.addEventListener("click", async (event) => {
      const removeRoleButton = event.target.closest("[data-remove-role]");
      if (removeRoleButton) {
        const roleType = removeRoleButton.getAttribute("data-remove-role");
        const roleId = removeRoleButton.getAttribute("data-role-id");
        const roleLabelText = removeRoleButton.getAttribute("data-role-label");
        if (!window.confirm(`Remove ${roleLabel(roleType)} '${roleLabelText}' from the market?`)) {
          return;
        }
        try {
          await adminMutate(
            "/api/admin/remove-role",
            { roleType, roleId },
            `Removed ${roleLabel(roleType).toLowerCase()} '${roleLabelText}'.`,
          );
        } catch (error) {
          log(error.message);
        }
        return;
      }

      const saveRankingButton = event.target.closest("[data-save-ranking]");
      if (!saveRankingButton) {
        return;
      }

      const type = saveRankingButton.getAttribute("data-save-ranking");
      const entityId = saveRankingButton.getAttribute("data-entity-id");
      const textarea = document.querySelector(
        `textarea[data-ranking-type="${type}"][data-entity-id="${entityId}"]`,
      );
      const orderedIds = parseOrderedIds(textarea.value);

      try {
        if (type === "hospital") {
          await adminMutate(
            "/api/rankings/hospital",
            {
              hospitalId: entityId,
              orderedCandidateIds: orderedIds,
            },
            `Saved ranking for hospital '${entityId}'.`,
          );
        } else {
          await adminMutate(
            "/api/rankings/candidate",
            {
              candidateId: entityId,
              orderedHospitalIds: orderedIds,
            },
            `Saved ranking for student '${entityId}'.`,
          );
        }
      } catch (error) {
        log(error.message);
      }
    });
  }

  async function init() {
    renderAll();
    attachHandlers();
    try {
      await refreshAll({ quiet: true });
      log("Loaded public market.");
    } catch (error) {
      renderAll();
      log("Check the backend connection.");
    }
  }

  init();
}());
