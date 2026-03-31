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
  participantRankingList: document.getElementById("participant-ranking-list"),
  participantLoad: document.getElementById("participant-load"),
  participantSubmit: document.getElementById("participant-submit"),
  marketSummary: document.getElementById("market-summary"),
  adminSummary: document.getElementById("admin-summary"),
  hospitalSubmissionTable: document.getElementById("hospital-submission-table"),
  candidateSubmissionTable: document.getElementById("candidate-submission-table"),
  stabilityBadge: document.getElementById("stability-badge"),
  hospitalTable: document.getElementById("hospital-table"),
  candidateTable: document.getElementById("candidate-table"),
  hospitalRankings: document.getElementById("hospital-rankings"),
  candidateRankings: document.getElementById("candidate-rankings"),
  snapshot: document.getElementById("snapshot"),
  runSummary: document.getElementById("run-summary"),
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
  return roleType === "hospital" ? "Hospital" : "Candidate";
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      apiBase: elements.apiBase.value.trim(),
      adminKey: elements.adminKey.value,
      participantRoleType: elements.participantRoleType.value,
      participantName: elements.participantName.value.trim(),
    }),
  );
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    elements.apiBase.value = "https://matching.visiometrica.com";
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    elements.apiBase.value = parsed.apiBase || "https://matching.visiometrica.com";
    elements.adminKey.value = parsed.adminKey || "";
    elements.participantRoleType.value = parsed.participantRoleType || "candidate";
    elements.participantName.value = parsed.participantName || "";
  } catch {
    elements.apiBase.value = "https://matching.visiometrica.com";
  }
}

function getApiBase() {
  return elements.apiBase.value.trim().replace(/\/$/, "");
}

async function request(path, options = {}, includeAdmin = false) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (includeAdmin && elements.adminKey.value.trim()) {
    headers.set("X-Admin-Key", elements.adminKey.value.trim());
  }
  const response = await fetch(`${getApiBase()}${path}`, {
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
  const header = columns.map((column) => `<th>${column.label}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => {
            const value = column.render ? column.render(row) : (row[column.key] ?? "");
            return `<td>${escapeHtml(value)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<table class="table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function summaryBox(label, value) {
  return `<div class="summary-box"><span class="muted-text">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function currentRoleOptionsById() {
  const role = state.participantRole;
  if (!role) {
    return {};
  }
  return Object.fromEntries(role.choices.map((choice) => [choice.id, choice]));
}

function normalizeParticipantOrder(rolePayload) {
  const seen = new Set();
  const availableIds = rolePayload.choices.map((choice) => choice.id);
  const order = [];

  for (const choiceId of rolePayload.currentRanking || []) {
    if (availableIds.includes(choiceId) && !seen.has(choiceId)) {
      order.push(choiceId);
      seen.add(choiceId);
    }
  }
  for (const choiceId of availableIds) {
    if (!seen.has(choiceId)) {
      order.push(choiceId);
      seen.add(choiceId);
    }
  }
  return order;
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

function renderParticipantRoleChoices() {
  if (!state.participantRole) {
    elements.participantRankingList.innerHTML = `<p class="empty">Enter your name and start your entry to rank preferences.</p>`;
    return;
  }

  if (!state.participantRankingOrder.length) {
    elements.participantRankingList.innerHTML = `<p class="empty">No opposite-side roles exist yet. Wait for the other side to join or ask the admin to seed the market.</p>`;
    return;
  }

  const choicesById = currentRoleOptionsById();
  elements.participantRankingList.innerHTML = state.participantRankingOrder
    .map((choiceId, index) => {
      const choice = choicesById[choiceId];
      const capacityText = choice.capacity !== undefined ? `, capacity ${choice.capacity}` : "";
      return `
        <div class="choice-item">
          <div class="choice-main">
            <span class="choice-rank">${index + 1}</span>
            <div>
              <strong>${escapeHtml(choice.name)}</strong>
              <div class="muted-text">${escapeHtml(choice.id)}${escapeHtml(capacityText)}</div>
            </div>
          </div>
          <div class="actions compact">
            <button class="button" data-move-choice="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="button" data-move-choice="${index}" data-direction="1" ${index === state.participantRankingOrder.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderParticipantPanel() {
  const counts = state.publicMarket?.submissionCounts;
  if (!state.publicMarket || !counts) {
    elements.participantMarketBadge.textContent = "No market loaded";
    elements.participantMarketBadge.className = "badge muted";
  } else {
    elements.participantMarketBadge.textContent = `Hospitals ${counts.hospitalsSubmitted}/${counts.hospitalsTotal}, candidates ${counts.candidatesSubmitted}/${counts.candidatesTotal}`;
    elements.participantMarketBadge.className = "badge";
  }

  if (!state.participantRole) {
    elements.participantRoleTitle.textContent = "Choose your role and enter your name";
    elements.participantRoleMeta.textContent = "Start or resume your entry to see the opposite-side options.";
    elements.participantRoleBadge.textContent = "No submission";
    elements.participantRoleBadge.className = "badge muted";
    elements.participantSubmit.disabled = true;
    renderParticipantRoleChoices();
    return;
  }

  const role = state.participantRole.role;
  const side = roleLabel(state.participantRole.roleType);
  const capacityText = role.capacity !== undefined ? `, capacity ${role.capacity}` : "";
  elements.participantRoleTitle.textContent = `${side}: ${role.name}`;
  elements.participantRoleMeta.textContent = `${role.id}${capacityText}. Last submission: ${formatDate(state.participantRole.submittedAt)}.`;
  elements.participantRoleBadge.textContent = state.participantRole.submittedAt ? "Submitted" : "Draft only";
  elements.participantRoleBadge.className = state.participantRole.submittedAt ? "badge ok" : "badge warn";
  elements.participantSubmit.disabled = state.participantRankingOrder.length === 0;
  renderParticipantRoleChoices();
}

function renderAdminSummary() {
  if (!state.adminData) {
    elements.marketSummary.textContent = "Admin state unavailable";
    elements.marketSummary.className = "badge muted";
    elements.adminSummary.innerHTML = [
      summaryBox("Admin access", "Unavailable"),
      summaryBox("Reason", elements.adminKey.value.trim() ? "Check admin key" : "Enter admin key if required"),
      summaryBox("Public market", state.publicMarket ? "Loaded" : "Unavailable"),
    ].join("");
    return;
  }

  const hospitals = state.adminData.hospitals || [];
  const candidates = state.adminData.candidates || [];
  const counts = state.adminData.submissionSummary.counts;
  const slotCount = hospitals.reduce((sum, hospital) => sum + Number(hospital.capacity || 0), 0);
  elements.marketSummary.textContent = `${hospitals.length} hospitals, ${candidates.length} candidates, ${slotCount} slots`;
  elements.marketSummary.className = "badge";
  elements.adminSummary.innerHTML = [
    summaryBox("Hospitals submitted", `${counts.hospitalsSubmitted}/${counts.hospitalsTotal}`),
    summaryBox("Candidates submitted", `${counts.candidatesSubmitted}/${counts.candidatesTotal}`),
    summaryBox("Latest run", state.adminData.latestRun ? new Date(state.adminData.latestRun.createdAt).toLocaleString() : "None"),
  ].join("");
}

function renderSubmissionStatus() {
  if (!state.adminData) {
    elements.hospitalSubmissionTable.innerHTML = `<p class="empty">Admin access is required to see submission status.</p>`;
    elements.candidateSubmissionTable.innerHTML = `<p class="empty">Admin access is required to see submission status.</p>`;
    return;
  }

  elements.hospitalSubmissionTable.innerHTML = renderTable(
    [
      { label: "Hospital", render: (row) => `${row.name} (${row.id})` },
      { label: "Ranking", render: (row) => `${row.rankingCount}/${row.requiredCount}` },
      { label: "Submitted", render: (row) => (row.submitted ? "Yes" : "No") },
      { label: "Updated", render: (row) => formatDate(row.submittedAt) },
      { label: "Source", render: (row) => row.source || "—" },
    ],
    state.adminData.submissionSummary.hospitals,
  );

  elements.candidateSubmissionTable.innerHTML = renderTable(
    [
      { label: "Candidate", render: (row) => `${row.name} (${row.id})` },
      { label: "Ranking", render: (row) => `${row.rankingCount}/${row.requiredCount}` },
      { label: "Submitted", render: (row) => (row.submitted ? "Yes" : "No") },
      { label: "Updated", render: (row) => formatDate(row.submittedAt) },
      { label: "Source", render: (row) => row.source || "—" },
    ],
    state.adminData.submissionSummary.candidates,
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
    ],
    hospitals,
  );

  elements.candidateTable.innerHTML = renderTable(
    [
      { label: "ID", key: "id" },
      { label: "Name", key: "name" },
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
              <p class="ranking-meta">Candidate IDs in descending order. Available: ${escapeHtml(candidates.map((candidate) => candidate.id).join(", ") || "none")}.</p>
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
    : `<p class="empty">Add at least one candidate first.</p>`;
}

function renderSnapshot() {
  if (!state.adminData) {
    elements.snapshot.value = "";
    return;
  }
  elements.snapshot.value = JSON.stringify(
    {
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
    ].join("");
    elements.matchesTable.innerHTML = `<p class="empty">Run the algorithm to see assignments.</p>`;
    elements.blockingPairs.innerHTML = `<p class="empty">No run yet.</p>`;
    elements.traceTable.innerHTML = `<p class="empty">No trace yet.</p>`;
    elements.stabilityBadge.textContent = "No run yet";
    elements.stabilityBadge.className = "badge muted";
    return;
  }

  const stats = run.stats;
  const hospitals = state.adminData.hospitals;
  const candidatesById = Object.fromEntries(state.adminData.candidates.map((candidate) => [candidate.id, candidate]));

  elements.runSummary.innerHTML = [
    summaryBox("Proposer side", run.proposerSide),
    summaryBox("Matched pairs", `${stats.matchedCount}/${Math.min(stats.candidateCount, stats.totalSlots)}`),
    summaryBox("Candidate avg. rank", stats.averageCandidateRank ?? "n/a"),
    summaryBox("Hospital avg. rank", stats.averageHospitalRank ?? "n/a"),
    summaryBox("Blocking pairs", stats.blockingPairs.length),
    summaryBox("Created at", new Date(run.createdAt).toLocaleString()),
  ].join("");

  elements.stabilityBadge.textContent = stats.isStable ? "Stable" : "Blocking pairs found";
  elements.stabilityBadge.className = `badge ${stats.isStable ? "ok" : "warn"}`;

  const matchRows = hospitals.map((hospital) => ({
    hospital: hospital.name,
    capacity: hospital.capacity,
    matches: (run.hospitalMatches[hospital.id] || [])
      .map((candidateId) => candidatesById[candidateId]?.name || candidateId)
      .join(", ") || "Unfilled",
  }));
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
        { label: "Candidate", key: "candidateName" },
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
      {
        label: "Displaced",
        render: (row) => row.displacedProposerName || "—",
      },
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

async function registerParticipant({ quiet = false } = {}) {
  const roleType = elements.participantRoleType.value;
  const name = elements.participantName.value.trim();
  if (!name) {
    state.participantRole = null;
    state.participantRankingOrder = [];
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
  state.participantRankingOrder = normalizeParticipantOrder(state.participantRole);
  elements.participantName.value = state.participantRole.role.name;
  saveSettings();
  if (!quiet) {
    log(
      `${state.participantRole.created ? "Created" : "Loaded"} ${roleLabel(roleType).toLowerCase()} entry '${state.participantRole.role.name}'.`,
    );
  }
}

async function refreshAll({ quiet = false } = {}) {
  await refreshPublicMarket({ quiet: true });
  await refreshAdminState({ quiet: true });
  if (elements.participantName.value.trim()) {
    try {
      await registerParticipant({ quiet: true });
    } catch (error) {
      state.participantRole = null;
      state.participantRankingOrder = [];
      if (!quiet) {
        log(error.message);
      }
    }
  } else {
    state.participantRole = null;
    state.participantRankingOrder = [];
  }
  renderAll();
  if (!quiet) {
    log("Refreshed public and admin data.");
  }
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
    log("Choose your side, enter your name, and start your entry before submitting preferences.");
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
  state.participantRankingOrder = normalizeParticipantOrder(payload);
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
      saveSettings();
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
    saveSettings();
    renderAll();
    log("Admin session cleared from this browser.");
  });

  elements.participantRoleType.addEventListener("change", () => {
    state.participantRole = null;
    state.participantRankingOrder = [];
    saveSettings();
    renderAll();
  });

  elements.participantName.addEventListener("input", () => {
    state.participantRole = null;
    state.participantRankingOrder = [];
    saveSettings();
    renderAll();
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

  document.getElementById("load-demo").addEventListener("click", async () => {
    try {
      await adminMutate("/api/admin/load-demo", {}, "Loaded textbook demo market.");
    } catch (error) {
      log(error.message);
    }
  });

  document.getElementById("run-hospital").addEventListener("click", async () => {
    try {
      await adminMutate("/api/run", { proposerSide: "hospital" }, "Ran hospital-proposing deferred acceptance.");
    } catch (error) {
      log(error.message);
    }
  });

  document.getElementById("run-candidate").addEventListener("click", async () => {
    try {
      await adminMutate("/api/run", { proposerSide: "candidate" }, "Ran candidate-proposing deferred acceptance.");
    } catch (error) {
      log(error.message);
    }
  });

  document.getElementById("reset-market").addEventListener("click", async () => {
    if (!window.confirm("Reset the entire market and clear all saved rankings?")) {
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
        `Saved candidate '${elements.candidateName.value.trim()}'.`,
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

  document.body.addEventListener("click", async (event) => {
    const moveButton = event.target.closest("[data-move-choice]");
    if (moveButton) {
      moveParticipantChoice(
        Number(moveButton.getAttribute("data-move-choice")),
        Number(moveButton.getAttribute("data-direction")),
      );
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
          `Saved ranking for candidate '${entityId}'.`,
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
