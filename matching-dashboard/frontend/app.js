const SETTINGS_KEY = "matching-dashboard-settings";

const elements = {
  apiBase: document.getElementById("api-base"),
  adminKey: document.getElementById("admin-key"),
  connectionBadge: document.getElementById("connection-badge"),
  adminBadge: document.getElementById("admin-badge"),
  participantMarketBadge: document.getElementById("participant-market-badge"),
  participantRoleType: document.getElementById("participant-role-type"),
  participantName: document.getElementById("participant-name"),
  participantRoleTitle: document.getElementById("participant-role-title"),
  participantRoleMeta: document.getElementById("participant-role-meta"),
  participantRoleBadge: document.getElementById("participant-role-badge"),
  participantRankingNote: document.getElementById("participant-ranking-note"),
  participantPickerGrid: document.getElementById("participant-picker-grid"),
  participantChoiceSearch: document.getElementById("participant-choice-search"),
  participantAvailableList: document.getElementById("participant-available-list"),
  participantSelectedList: document.getElementById("participant-selected-list"),
  participantLimitBadge: document.getElementById("participant-limit-badge"),
  participantSelectedCount: document.getElementById("participant-selected-count"),
  participantLoad: document.getElementById("participant-load"),
  participantSubmit: document.getElementById("participant-submit"),
  marketSummary: document.getElementById("market-summary"),
  adminSummary: document.getElementById("admin-summary"),
  openRegistration: document.getElementById("open-registration"),
  openRanking: document.getElementById("open-ranking"),
  lockMarket: document.getElementById("lock-market"),
  loadDemo: document.getElementById("load-demo"),
  runHospital: document.getElementById("run-hospital"),
  runCandidate: document.getElementById("run-candidate"),
  resetMarket: document.getElementById("reset-market"),
  hospitalSubmissionFilter: document.getElementById("hospital-submission-filter"),
  candidateSubmissionFilter: document.getElementById("candidate-submission-filter"),
  hospitalSubmissionTable: document.getElementById("hospital-submission-table"),
  candidateSubmissionTable: document.getElementById("candidate-submission-table"),
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
  adminSections: Array.from(document.querySelectorAll(".admin-only")),
};

const state = {
  publicMarket: null,
  adminData: null,
  participantRole: null,
  participantRankingOrder: [],
  participantChoiceQuery: "",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  elements.statusLog.textContent = `[${timestamp}] ${message}\n${elements.statusLog.textContent}`.trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not submitted";
}

function roleLabel(roleType) {
  return roleType === "hospital" ? "Hospital" : "Student";
}

function phaseLabel(phase) {
  const labels = {
    registration_open: "Registration open",
    ranking_open: "Ranking open",
    locked: "Locked",
  };
  return labels[phase] || "Unknown phase";
}

function getRankingLimit() {
  return state.publicMarket?.rankingLimit || state.participantRole?.rankingLimit || 10;
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      apiBase: elements.apiBase.value.trim(),
    }),
  );
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    elements.apiBase.value = "";
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    elements.apiBase.value = parsed.apiBase || "";
  } catch {
    elements.apiBase.value = "";
  }
}

function getApiBase() {
  return elements.apiBase.value.trim().replace(/\/$/, "");
}

async function request(path, options = {}, includeAdmin = false) {
  const apiBase = getApiBase();
  if (!apiBase) {
    throw new Error("Set the API base URL first.");
  }
  if (window.location.protocol === "https:" && apiBase.startsWith("http://")) {
    throw new Error("This page is on HTTPS, so the API base URL must also use HTTPS.");
  }
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (includeAdmin && elements.adminKey.value.trim()) {
    headers.set("X-Admin-Key", elements.adminKey.value.trim());
  }
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function publicApi(path, options = {}) {
  return request(path, options, false);
}

function adminApi(path, options = {}) {
  return request(path, options, true);
}

function renderTable(columns, rows) {
  if (!rows.length) {
    return `<p class="empty">Nothing here yet.</p>`;
  }
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const value = column.render ? column.render(row) : (row[column.key] ?? "");
          return `<td>${column.html ? value : escapeHtml(value)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table class="table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function summaryBox(label, value) {
  return `<div class="summary-box"><span class="muted-text">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function filterRows(rows, query, selectors) {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) {
    return rows;
  }
  return rows.filter((row) =>
    selectors.some((selector) => String(selector(row) ?? "").toLowerCase().includes(cleaned)),
  );
}

function currentRoleOptionsById() {
  const role = state.participantRole;
  if (!role) {
    return {};
  }
  return Object.fromEntries(role.choices.map((choice) => [choice.id, choice]));
}

function normalizeParticipantRanking(rolePayload) {
  const availableIds = new Set(rolePayload.choices.map((choice) => choice.id));
  const seen = new Set();
  const ranking = [];
  const limit = rolePayload.rankingLimit || getRankingLimit();
  for (const choiceId of rolePayload.currentRanking || []) {
    if (!availableIds.has(choiceId) || seen.has(choiceId) || ranking.length >= limit) {
      continue;
    }
    ranking.push(choiceId);
    seen.add(choiceId);
  }
  return ranking;
}

function participantSelectionBadge() {
  const selected = state.participantRankingOrder.length;
  const limit = getRankingLimit();
  elements.participantSelectedCount.textContent = `${selected} / ${limit}`;
  elements.participantLimitBadge.textContent = `Top ${limit}`;
}

function renderParticipantChoiceItem(choice, actionsHtml, rankLabel = null) {
  const capacityText = choice.capacity !== undefined ? `Capacity ${choice.capacity}` : roleLabel("candidate");
  const rank = rankLabel ? `<span class="choice-rank">${rankLabel}</span>` : "";
  return `
    <div class="choice-item">
      <div class="choice-main">
        ${rank}
        <div>
          <strong>${escapeHtml(choice.name)}</strong>
          <div class="muted-text">${escapeHtml(choice.id)} · ${escapeHtml(capacityText)}</div>
        </div>
      </div>
      <div class="actions compact">
        ${actionsHtml}
      </div>
    </div>
  `;
}

function renderParticipantPicker(phase) {
  participantSelectionBadge();
  elements.participantChoiceSearch.value = state.participantChoiceQuery;
  elements.participantChoiceSearch.disabled = phase !== "ranking_open";

  if (!state.participantRole || !["ranking_open", "locked"].includes(phase)) {
    elements.participantPickerGrid.hidden = true;
    elements.participantAvailableList.innerHTML = "";
    elements.participantSelectedList.innerHTML = "";
    return;
  }

  const choicesById = currentRoleOptionsById();
  const limit = getRankingLimit();
  const selectedIds = new Set(state.participantRankingOrder);
  const query = state.participantChoiceQuery.trim().toLowerCase();
  const availableChoices = state.participantRole.choices.filter((choice) => {
    if (selectedIds.has(choice.id)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      choice.name.toLowerCase().includes(query)
      || choice.id.toLowerCase().includes(query)
    );
  });

  elements.participantPickerGrid.hidden = false;
  if (phase === "ranking_open") {
    elements.participantAvailableList.innerHTML = availableChoices.length
      ? availableChoices
          .map((choice) =>
            renderParticipantChoiceItem(
              choice,
              `<button class="button" data-add-choice="${escapeHtml(choice.id)}" ${state.participantRankingOrder.length >= limit ? "disabled" : ""}>Add</button>`,
            ),
          )
          .join("")
      : `<p class="empty">No matching options are available.</p>`;
  } else {
    elements.participantAvailableList.innerHTML = `<p class="empty">The market is locked. New choices cannot be added.</p>`;
  }

  elements.participantSelectedList.innerHTML = state.participantRankingOrder.length
    ? state.participantRankingOrder
        .map((choiceId, index) => {
          const choice = choicesById[choiceId];
          const actions = phase === "ranking_open"
            ? `
                <button class="button" data-move-choice="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
                <button class="button" data-move-choice="${index}" data-direction="1" ${index === state.participantRankingOrder.length - 1 ? "disabled" : ""}>↓</button>
                <button class="button" data-remove-choice="${escapeHtml(choice.id)}">Remove</button>
              `
            : "";
          return renderParticipantChoiceItem(choice, actions, index + 1);
        })
        .join("")
    : `<p class="empty">${phase === "ranking_open" ? "Add up to ten choices from the left." : "No ranking was submitted."}</p>`;
}

function renderConnectionBadges() {
  if (state.publicMarket) {
    elements.connectionBadge.textContent = "Public API reachable";
    elements.connectionBadge.className = "badge ok";
  } else {
    elements.connectionBadge.textContent = "Public API unavailable";
    elements.connectionBadge.className = "badge warn";
  }

  if (state.adminData) {
    elements.adminBadge.textContent = "Admin panel unlocked";
    elements.adminBadge.className = "badge ok";
  } else if (elements.adminKey.value.trim()) {
    elements.adminBadge.textContent = "Admin key rejected or missing";
    elements.adminBadge.className = "badge warn";
  } else {
    elements.adminBadge.textContent = "Admin locked";
    elements.adminBadge.className = "badge muted";
  }
}

function renderAdminVisibility() {
  const unlocked = Boolean(state.adminData);
  elements.adminSections.forEach((section) => {
    section.hidden = !unlocked;
  });
}

function renderParticipantPanel() {
  const market = state.publicMarket;
  const counts = market?.submissionCounts;
  const phase = market?.phase;
  if (!market || !counts) {
    elements.participantMarketBadge.textContent = "No market loaded";
    elements.participantMarketBadge.className = "badge muted";
  } else {
    elements.participantMarketBadge.textContent = `${phaseLabel(phase)} · Hospitals ${counts.hospitalsSubmitted}/${counts.hospitalsTotal} · Students ${counts.candidatesSubmitted}/${counts.candidatesTotal}`;
    elements.participantMarketBadge.className = "badge";
  }

  if (!state.participantRole) {
    elements.participantRoleTitle.textContent = "Choose your role and enter your name";
    if (!market) {
      elements.participantRoleMeta.textContent = "Set the API base URL, check the connection, and make sure the backend is reachable.";
      elements.participantRankingNote.textContent = "";
    } else if (phase === "registration_open") {
      elements.participantRoleMeta.textContent = "Register now to claim one role in the market.";
      elements.participantRankingNote.textContent = "Ranking opens only after the admin closes registration.";
    } else if (phase === "ranking_open") {
      elements.participantRoleMeta.textContent = "Registration is closed. Previously registered participants can reopen their entry with the same role and name.";
      elements.participantRankingNote.textContent = "You can only submit rankings for an existing entry during this phase.";
    } else {
      elements.participantRoleMeta.textContent = "The market is locked.";
      elements.participantRankingNote.textContent = "Public submissions are closed until the admin reopens the market.";
    }
    elements.participantRoleBadge.textContent = "No entry";
    elements.participantRoleBadge.className = "badge muted";
    elements.participantLoad.disabled = !market;
    elements.participantSubmit.disabled = true;
    renderParticipantPicker(null);
    return;
  }

  const role = state.participantRole.role;
  const side = roleLabel(state.participantRole.roleType);
  const capacityText = role.capacity !== undefined ? `, capacity ${role.capacity}` : "";
  elements.participantRoleTitle.textContent = `${side}: ${role.name}`;
  elements.participantLoad.disabled = false;

  if (phase === "registration_open") {
    elements.participantRoleMeta.textContent = `${role.id}${capacityText}. Registration saved. Ranking will open after the admin closes registration.`;
    elements.participantRoleBadge.textContent = "Registered";
    elements.participantRoleBadge.className = "badge ok";
    elements.participantRankingNote.textContent = "No rankings can be submitted during the registration phase.";
    elements.participantSubmit.disabled = true;
    renderParticipantPicker(null);
    return;
  }

  if (phase === "ranking_open") {
    elements.participantRoleMeta.textContent = `${role.id}${capacityText}. Choose up to ${getRankingLimit()} options in descending order. Last submission: ${formatDate(state.participantRole.submittedAt)}.`;
    elements.participantRoleBadge.textContent = state.participantRole.submittedAt ? "Submitted" : "Ready to rank";
    elements.participantRoleBadge.className = state.participantRole.submittedAt ? "badge ok" : "badge warn";
    elements.participantRankingNote.textContent = "Add up to ten options, then order them from best to worst.";
    elements.participantSubmit.disabled = state.participantRankingOrder.length === 0;
    renderParticipantPicker("ranking_open");
    return;
  }

  elements.participantRoleMeta.textContent = `${role.id}${capacityText}. The market is locked. Last submission: ${formatDate(state.participantRole.submittedAt)}.`;
  elements.participantRoleBadge.textContent = state.participantRole.submittedAt ? "Locked" : "Locked without submission";
  elements.participantRoleBadge.className = state.participantRole.submittedAt ? "badge muted" : "badge warn";
  elements.participantRankingNote.textContent = "Your final submitted list is shown below.";
  elements.participantSubmit.disabled = true;
  renderParticipantPicker("locked");
}

function renderAdminSummary() {
  if (!state.adminData) {
    elements.marketSummary.textContent = "Admin state unavailable";
    elements.marketSummary.className = "badge muted";
    elements.adminSummary.innerHTML = [
      summaryBox("Admin access", "Unavailable"),
      summaryBox("Phase", "Unknown"),
      summaryBox("Public market", state.publicMarket ? "Loaded" : "Unavailable"),
      summaryBox("Ranking limit", state.publicMarket?.rankingLimit || "n/a"),
    ].join("");
    return;
  }

  const hospitals = state.adminData.hospitals || [];
  const candidates = state.adminData.candidates || [];
  const counts = state.adminData.submissionSummary.counts;
  const slotCount = hospitals.reduce((sum, hospital) => sum + Number(hospital.capacity || 0), 0);
  const phase = state.adminData.phase;
  elements.marketSummary.textContent = `${phaseLabel(phase)} · ${hospitals.length} hospitals · ${candidates.length} students · ${slotCount} slots`;
  elements.marketSummary.className = "badge";
  elements.adminSummary.innerHTML = [
    summaryBox("Phase", phaseLabel(phase)),
    summaryBox("Hospitals submitted", `${counts.hospitalsSubmitted}/${counts.hospitalsTotal}`),
    summaryBox("Students submitted", `${counts.candidatesSubmitted}/${counts.candidatesTotal}`),
    summaryBox("Latest run", state.adminData.latestRun ? new Date(state.adminData.latestRun.createdAt).toLocaleString() : "None"),
  ].join("");

  elements.openRegistration.disabled = phase === "registration_open";
  elements.openRanking.disabled = phase === "ranking_open";
  elements.lockMarket.disabled = phase === "locked";
  elements.runHospital.disabled = phase !== "locked";
  elements.runCandidate.disabled = phase !== "locked";
}

function renderSubmissionStatus() {
  if (!state.adminData) {
    elements.hospitalSubmissionTable.innerHTML = `<p class="empty">Admin access is required to see submission status.</p>`;
    elements.candidateSubmissionTable.innerHTML = `<p class="empty">Admin access is required to see submission status.</p>`;
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

function orderedText(ids) {
  return ids.join(", ");
}

function parseOrderedIds(text) {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderRankingEditors() {
  const hospitals = state.adminData?.hospitals || [];
  const candidates = state.adminData?.candidates || [];
  const hospitalRankings = state.adminData?.hospitalRankings || {};
  const candidateRankings = state.adminData?.candidateRankings || {};

  if (!state.adminData) {
    elements.hospitalRankings.innerHTML = `<p class="empty">Admin access is required for manual overrides.</p>`;
    elements.candidateRankings.innerHTML = `<p class="empty">Admin access is required for manual overrides.</p>`;
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
  const run = state.adminData?.latestRun;
  if (!run) {
    elements.runSummary.innerHTML = [
      summaryBox("Latest run", "None yet"),
      summaryBox("Proposer side", "n/a"),
      summaryBox("Stable", "n/a"),
      summaryBox("Ranking limit", getRankingLimit()),
    ].join("");
    elements.matchesTable.innerHTML = `<p class="empty">Lock the market and run the algorithm to see assignments.</p>`;
    elements.blockingPairs.innerHTML = `<p class="empty">No run yet.</p>`;
    elements.traceTable.innerHTML = `<p class="empty">No trace yet.</p>`;
    elements.stabilityBadge.textContent = "No run yet";
    elements.stabilityBadge.className = "badge muted";
    return;
  }

  const stats = run.stats;
  const hospitalsById = Object.fromEntries(state.adminData.hospitals.map((hospital) => [hospital.id, hospital]));
  const candidatesById = Object.fromEntries(state.adminData.candidates.map((candidate) => [candidate.id, candidate]));
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
    summaryBox("Created at", new Date(run.createdAt).toLocaleString()),
  ].join("");

  elements.stabilityBadge.textContent = stats.isStable ? "Stable" : "Blocking pairs found";
  elements.stabilityBadge.className = `badge ${stats.isStable ? "ok" : "warn"}`;

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
  renderParticipantPanel();
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
    state.adminData = await adminApi("/api/state", { method: "GET" });
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

async function refreshParticipantRole({ quiet = false } = {}) {
  if (!state.participantRole) {
    return;
  }
  try {
    const payload = await publicApi(
      `/api/public/role?roleType=${encodeURIComponent(state.participantRole.roleType)}&roleId=${encodeURIComponent(state.participantRole.role.id)}`,
      { method: "GET" },
    );
    state.participantRole = payload;
    state.participantRankingOrder = normalizeParticipantRanking(payload);
  } catch (error) {
    state.participantRole = null;
    state.participantRankingOrder = [];
    state.participantChoiceQuery = "";
    if (!quiet) {
      log(error.message);
    }
  }
}

async function registerParticipant({ quiet = false } = {}) {
  const roleType = elements.participantRoleType.value;
  const name = elements.participantName.value.trim();
  if (!name) {
    state.participantRole = null;
    state.participantRankingOrder = [];
    state.participantChoiceQuery = "";
    if (!quiet) {
      throw new Error("Enter your name before starting your entry.");
    }
    return;
  }
  state.participantRole = await publicApi("/api/public/register", {
    method: "POST",
    body: JSON.stringify({
      roleType,
      name,
    }),
  });
  state.participantRankingOrder = normalizeParticipantRanking(state.participantRole);
  state.participantChoiceQuery = "";
  elements.participantName.value = state.participantRole.role.name;
  if (!quiet) {
    log(
      `${state.participantRole.created ? "Created" : "Loaded"} ${roleLabel(roleType).toLowerCase()} entry '${state.participantRole.role.name}'.`,
    );
  }
}

async function refreshAll({ quiet = false } = {}) {
  await refreshPublicMarket({ quiet: true });
  await refreshAdminState({ quiet: true });
  await refreshParticipantRole({ quiet: true });
  renderAll();
  if (!quiet) {
    log("Refreshed public and admin data.");
  }
}

function addParticipantChoice(choiceId) {
  if (!state.participantRole || state.participantRankingOrder.includes(choiceId)) {
    return;
  }
  if (state.participantRankingOrder.length >= getRankingLimit()) {
    return;
  }
  state.participantRankingOrder = [...state.participantRankingOrder, choiceId];
  renderParticipantPanel();
}

function removeParticipantChoice(choiceId) {
  state.participantRankingOrder = state.participantRankingOrder.filter((item) => item !== choiceId);
  renderParticipantPanel();
}

function moveParticipantChoice(index, direction) {
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.participantRankingOrder.length) {
    return;
  }
  const order = [...state.participantRankingOrder];
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  state.participantRankingOrder = order;
  renderParticipantPanel();
}

async function submitParticipantRanking() {
  if (!state.participantRole) {
    log("Load your entry before submitting preferences.");
    return;
  }
  const payload = await publicApi("/api/public/submit", {
    method: "POST",
    body: JSON.stringify({
      roleType: state.participantRole.roleType,
      roleId: state.participantRole.role.id,
      orderedIds: state.participantRankingOrder,
    }),
  });
  state.participantRole = payload;
  state.participantRankingOrder = normalizeParticipantRanking(payload);
  await refreshPublicMarket({ quiet: true });
  await refreshAdminState({ quiet: true });
  renderAll();
  log(`Submitted preferences for ${roleLabel(payload.roleType).toLowerCase()} '${payload.role.name}'.`);
}

async function adminMutate(path, body, successMessage) {
  await adminApi(path, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
  await refreshAll({ quiet: true });
  log(successMessage);
}

function attachHandlers() {
  document.getElementById("save-settings").addEventListener("click", () => {
    saveSettings();
    log("Settings saved locally.");
  });

  document.getElementById("check-connection").addEventListener("click", async () => {
    try {
      saveSettings();
      await refreshAll();
    } catch (error) {
      renderAll();
      log(error.message);
    }
  });

  document.getElementById("refresh-state").addEventListener("click", async () => {
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

  elements.participantRoleType.addEventListener("change", () => {
    state.participantRole = null;
    state.participantRankingOrder = [];
    state.participantChoiceQuery = "";
    renderAll();
  });

  elements.participantName.addEventListener("input", () => {
    state.participantRole = null;
    state.participantRankingOrder = [];
    state.participantChoiceQuery = "";
    renderAll();
  });

  elements.participantChoiceSearch.addEventListener("input", (event) => {
    state.participantChoiceQuery = event.target.value;
    renderParticipantPanel();
  });

  elements.participantLoad.addEventListener("click", async () => {
    try {
      await registerParticipant();
      await refreshPublicMarket({ quiet: true });
      await refreshAdminState({ quiet: true });
      renderAll();
    } catch (error) {
      state.participantRole = null;
      state.participantRankingOrder = [];
      state.participantChoiceQuery = "";
      renderAll();
      log(error.message);
    }
  });

  elements.participantSubmit.addEventListener("click", async () => {
    try {
      await submitParticipantRanking();
    } catch (error) {
      renderAll();
      log(error.message);
    }
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

  elements.resetMarket.addEventListener("click", async () => {
    if (!window.confirm("Reset the entire market and clear all saved registrations, rankings, and runs?")) {
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
    const addButton = event.target.closest("[data-add-choice]");
    if (addButton) {
      addParticipantChoice(addButton.getAttribute("data-add-choice"));
      return;
    }

    const removeChoiceButton = event.target.closest("[data-remove-choice]");
    if (removeChoiceButton) {
      removeParticipantChoice(removeChoiceButton.getAttribute("data-remove-choice"));
      return;
    }

    const moveButton = event.target.closest("[data-move-choice]");
    if (moveButton) {
      moveParticipantChoice(
        Number(moveButton.getAttribute("data-move-choice")),
        Number(moveButton.getAttribute("data-direction")),
      );
      return;
    }

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
  loadSettings();
  renderAll();
  attachHandlers();
  try {
    await refreshAll({ quiet: true });
    log("Loaded public market.");
  } catch (error) {
    renderAll();
    log("Set the API base URL and check the backend.");
  }
}

init();
