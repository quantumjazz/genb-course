(function () {
  const {
    createLogger,
    escapeHtml,
    formatDate,
    phaseLabel,
    publicApi,
    renderTable,
    roleLabel,
    setBadge,
    summaryBox,
  } = window.MatchingShared;

  const AUTO_REFRESH_MS = 30000;

  const elements = {
    connectionBadge: document.getElementById("connection-badge"),
    marketStatusBadge: document.getElementById("market-status-badge"),
    marketSummaryGrid: document.getElementById("market-summary-grid"),
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
    participantReset: document.getElementById("participant-reset"),
    participantSubmit: document.getElementById("participant-submit"),
    refreshNow: document.getElementById("refresh-now"),
    resultBadge: document.getElementById("result-badge"),
    resultSummaryGrid: document.getElementById("result-summary-grid"),
    resultBody: document.getElementById("result-body"),
    statusLog: document.getElementById("status-log"),
  };

  const state = {
    publicMarket: null,
    participantRole: null,
    participantRankingOrder: [],
    participantChoiceQuery: "",
    draftDirty: false,
    refreshInFlight: false,
  };

  const log = createLogger(elements.statusLog);

  function getRankingLimit() {
    return state.publicMarket?.rankingLimit || state.participantRole?.rankingLimit || 10;
  }

  function isDocumentVisible() {
    return document.visibilityState !== "hidden";
  }

  function currentRoleOptionsById() {
    const role = state.participantRole;
    if (!role) {
      return {};
    }
    return Object.fromEntries(role.choices.map((choice) => [choice.id, choice]));
  }

  function normalizeChoiceOrder(choiceIds, rolePayload) {
    const availableIds = new Set(rolePayload.choices.map((choice) => choice.id));
    const seen = new Set();
    const ranking = [];
    const limit = rolePayload.rankingLimit || getRankingLimit();
    for (const choiceId of choiceIds || []) {
      if (!availableIds.has(choiceId) || seen.has(choiceId) || ranking.length >= limit) {
        continue;
      }
      ranking.push(choiceId);
      seen.add(choiceId);
    }
    return ranking;
  }

  function normalizeParticipantRanking(rolePayload) {
    return normalizeChoiceOrder(rolePayload.currentRanking || [], rolePayload);
  }

  function rankingsEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }

  function persistedParticipantRanking() {
    return state.participantRole ? normalizeParticipantRanking(state.participantRole) : [];
  }

  function updateDraftDirty() {
    state.draftDirty = state.participantRole
      ? !rankingsEqual(state.participantRankingOrder, persistedParticipantRanking())
      : false;
  }

  function participantSelectionBadge() {
    const selected = state.participantRankingOrder.length;
    const limit = getRankingLimit();
    elements.participantSelectedCount.textContent = `${selected} / ${limit}`;
    elements.participantLimitBadge.textContent = `Top ${limit}`;
  }

  function clearActiveParticipant() {
    state.participantRole = null;
    state.participantRankingOrder = [];
    state.participantChoiceQuery = "";
    state.draftDirty = false;
    elements.participantRoleType.value = "candidate";
    elements.participantName.value = "";
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
      return choice.name.toLowerCase().includes(query) || choice.id.toLowerCase().includes(query);
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

  function renderConnection() {
    if (state.publicMarket) {
      setBadge(elements.connectionBadge, "Public API reachable", "ok");
    } else {
      setBadge(elements.connectionBadge, "Public API unavailable", "warn");
    }
  }

  function renderMarketStatus() {
    const market = state.publicMarket;
    const counts = market?.submissionCounts;
    if (!market || !counts) {
      setBadge(elements.marketStatusBadge, "No market loaded", "muted");
      elements.marketSummaryGrid.innerHTML = [
        summaryBox("Phase", "Unknown"),
        summaryBox("Hospitals", "n/a"),
        summaryBox("Students", "n/a"),
        summaryBox("Published result", "Unavailable"),
      ].join("");
      return;
    }

    const publishedText = market.publishedRun
      ? `${roleLabel(market.publishedRun.proposerSide)}-proposing · ${formatDate(market.publishedRun.createdAt, "n/a")}`
      : "Not published";

    setBadge(
      elements.marketStatusBadge,
      `${phaseLabel(market.phase)} · ${market.publishedRun ? "Published result available" : "No published result"}`,
      market.publishedRun ? "ok" : "",
    );
    elements.marketSummaryGrid.innerHTML = [
      summaryBox("Phase", phaseLabel(market.phase)),
      summaryBox("Hospitals submitted", `${counts.hospitalsSubmitted}/${counts.hospitalsTotal}`),
      summaryBox("Students submitted", `${counts.candidatesSubmitted}/${counts.candidatesTotal}`),
      summaryBox("Published result", publishedText),
    ].join("");
  }

  function renderParticipantPanel() {
    const market = state.publicMarket;
    const counts = market?.submissionCounts;
    const phase = market?.phase;
    const hasActiveEntry = Boolean(state.participantRole);

    elements.participantRoleType.disabled = hasActiveEntry;
    elements.participantName.disabled = hasActiveEntry;
    elements.participantLoad.hidden = hasActiveEntry;
    elements.participantReset.hidden = !hasActiveEntry;

    if (!market || !counts) {
      setBadge(elements.participantMarketBadge, "No market loaded", "muted");
    } else {
      setBadge(
        elements.participantMarketBadge,
        `${phaseLabel(phase)} · Hospitals ${counts.hospitalsSubmitted}/${counts.hospitalsTotal} · Students ${counts.candidatesSubmitted}/${counts.candidatesTotal}`,
        "",
      );
    }

    if (!hasActiveEntry) {
      elements.participantRoleTitle.textContent = "Choose your role and open your entry";
      if (!market) {
        elements.participantRoleMeta.textContent = "Wait for the page to reach the public market service.";
        elements.participantRankingNote.textContent = "";
      } else if (phase === "registration_open") {
        elements.participantRoleMeta.textContent = "Registration is open. Create or reopen your entry.";
        elements.participantRankingNote.textContent = "After you open your entry, this page will keep that draft active until you switch participants.";
      } else if (phase === "ranking_open") {
        elements.participantRoleMeta.textContent = "Registration is closed. Reopen your existing entry with the same role and name.";
        elements.participantRankingNote.textContent = "After you open your entry, you can review and submit your ranking draft.";
      } else {
        elements.participantRoleMeta.textContent = market.publishedRun
          ? "The market is locked. Reopen your existing entry to view your published personal outcome."
          : "The market is locked. Public submissions are closed until the central office reopens the market.";
        elements.participantRankingNote.textContent = "No new public submissions can be made while the market is locked.";
      }
      setBadge(elements.participantRoleBadge, "No active draft", "muted");
      elements.participantLoad.disabled = !market;
      elements.participantSubmit.disabled = true;
      renderParticipantPicker(null);
      return;
    }

    const role = state.participantRole.role;
    const side = roleLabel(state.participantRole.roleType);
    const capacityText = role.capacity !== undefined ? `, capacity ${role.capacity}` : "";
    elements.participantRoleType.value = state.participantRole.roleType;
    elements.participantName.value = role.name;
    elements.participantRoleTitle.textContent = `${side}: ${role.name}`;

    if (phase === "registration_open") {
      elements.participantRoleMeta.textContent = `${role.id}${capacityText}. This entry is active on the page. Registration is saved, and rankings will open later.`;
      setBadge(elements.participantRoleBadge, "Active draft", "ok");
      elements.participantRankingNote.textContent = "Your identity is locked while this draft is open. Use Switch participant to leave it.";
      elements.participantSubmit.disabled = true;
      renderParticipantPicker(null);
      return;
    }

    if (phase === "ranking_open") {
      elements.participantRoleMeta.textContent = `${role.id}${capacityText}. Review your ranking draft and submit when ready. Last submission: ${formatDate(state.participantRole.submittedAt)}.`;
      if (state.draftDirty) {
        setBadge(elements.participantRoleBadge, "Draft changed", "warn");
      } else if (state.participantRole.submittedAt) {
        setBadge(elements.participantRoleBadge, "Submitted", "ok");
      } else {
        setBadge(elements.participantRoleBadge, "Review draft", "warn");
      }
      elements.participantRankingNote.textContent = "Your identity is locked while this draft is open. Use Switch participant to leave it.";
      elements.participantSubmit.disabled = state.participantRankingOrder.length === 0 || !state.draftDirty;
      renderParticipantPicker("ranking_open");
      return;
    }

    elements.participantRoleMeta.textContent = `${role.id}${capacityText}. The market is locked. Last submission: ${formatDate(state.participantRole.submittedAt)}.`;
    setBadge(
      elements.participantRoleBadge,
      state.participantRole.submittedAt ? "Locked draft" : "Locked without submission",
      state.participantRole.submittedAt ? "muted" : "warn",
    );
    elements.participantRankingNote.textContent = state.publicMarket?.publishedRun
      ? "Your final submitted list is shown below, and any published personal outcome appears in the next panel."
      : "Your final submitted list is shown below.";
    elements.participantSubmit.disabled = true;
    renderParticipantPicker("locked");
  }

  function renderPublishedResult() {
    const market = state.publicMarket;
    const publishedRun = market?.publishedRun;

    if (!market) {
      setBadge(elements.resultBadge, "No market loaded", "muted");
      elements.resultSummaryGrid.innerHTML = [
        summaryBox("Status", "Unavailable"),
        summaryBox("Proposer side", "n/a"),
        summaryBox("Run", "n/a"),
        summaryBox("Assigned", "n/a"),
      ].join("");
      elements.resultBody.innerHTML = `<p class="empty">Check the connection to load market information.</p>`;
      return;
    }

    if (!publishedRun) {
      setBadge(elements.resultBadge, "No published result", "muted");
      elements.resultSummaryGrid.innerHTML = [
        summaryBox("Status", "Pending"),
        summaryBox("Proposer side", "n/a"),
        summaryBox("Run", "n/a"),
        summaryBox("Assigned", "n/a"),
      ].join("");
      elements.resultBody.innerHTML = `<p class="empty">The central office has not published a result yet.</p>`;
      return;
    }

    if (!state.participantRole) {
      setBadge(elements.resultBadge, "Published result available", "ok");
      elements.resultSummaryGrid.innerHTML = [
        summaryBox("Status", "Published"),
        summaryBox("Proposer side", roleLabel(publishedRun.proposerSide)),
        summaryBox("Run", formatDate(publishedRun.createdAt, "n/a")),
        summaryBox("Assigned", "Open your entry"),
      ].join("");
      elements.resultBody.innerHTML = `<p class="empty">Open your entry with the same role and name to view your personal published outcome.</p>`;
      return;
    }

    const match = state.participantRole.publishedMatch;
    if (!match) {
      setBadge(elements.resultBadge, "Published result unavailable", "warn");
      elements.resultSummaryGrid.innerHTML = [
        summaryBox("Status", "Unavailable"),
        summaryBox("Proposer side", roleLabel(publishedRun.proposerSide)),
        summaryBox("Run", formatDate(publishedRun.createdAt, "n/a")),
        summaryBox("Assigned", "n/a"),
      ].join("");
      elements.resultBody.innerHTML = `<p class="empty">No published outcome is available for this entry.</p>`;
      return;
    }

    const hasAssignments = Boolean(match.matches.length);
    setBadge(
      elements.resultBadge,
      hasAssignments ? "Published personal outcome" : "Published: no assignment",
      hasAssignments ? "ok" : "warn",
    );
    elements.resultSummaryGrid.innerHTML = [
      summaryBox("Status", hasAssignments ? "Assigned" : "Unmatched"),
      summaryBox("Proposer side", roleLabel(match.proposerSide)),
      summaryBox("Run", formatDate(match.createdAt, "n/a")),
      summaryBox("Assigned", `${match.matchedCount}/${match.capacity}`),
    ].join("");

    if (state.participantRole.roleType === "hospital") {
      elements.resultBody.innerHTML = match.matches.length
        ? renderTable(
            [
              { label: "Student", key: "name" },
              { label: "ID", key: "id" },
            ],
            match.matches,
          )
        : `<p class="empty">No students were assigned to this hospital in the published run.</p>`;
      return;
    }

    elements.resultBody.innerHTML = match.matches.length
      ? renderTable(
          [
            { label: "Hospital", key: "name" },
            { label: "ID", key: "id" },
          ],
          match.matches,
        )
      : `<p class="empty">No hospital was assigned to this student in the published run.</p>`;
  }

  function renderAll() {
    renderConnection();
    renderMarketStatus();
    renderParticipantPanel();
    renderPublishedResult();
  }

  async function refreshPublicMarket() {
    const market = await publicApi("/api/public/market", { method: "GET" });
    state.publicMarket = market;
  }

  async function refreshParticipantRole() {
    if (!state.participantRole) {
      return;
    }

    const previousDraft = [...state.participantRankingOrder];
    const payload = await publicApi(
      `/api/public/role?roleType=${encodeURIComponent(state.participantRole.roleType)}&roleId=${encodeURIComponent(state.participantRole.role.id)}`,
      { method: "GET" },
    );
    const serverRanking = normalizeParticipantRanking(payload);
    state.participantRole = payload;
    if (state.draftDirty) {
      state.participantRankingOrder = normalizeChoiceOrder(previousDraft, payload);
      state.draftDirty = !rankingsEqual(state.participantRankingOrder, serverRanking);
    } else {
      state.participantRankingOrder = serverRanking;
      state.draftDirty = false;
    }
  }

  async function registerParticipant() {
    const roleType = elements.participantRoleType.value;
    const name = elements.participantName.value.trim();
    if (!name) {
      throw new Error("Enter your name before opening your entry.");
    }

    const payload = await publicApi("/api/public/register", {
      method: "POST",
      body: JSON.stringify({
        roleType,
        name,
      }),
    });

    state.participantRole = payload;
    state.participantRankingOrder = normalizeParticipantRanking(payload);
    state.participantChoiceQuery = "";
    state.draftDirty = false;
    elements.participantName.value = state.participantRole.role.name;
    log(
      `${state.participantRole.created ? "Created" : "Loaded"} ${roleLabel(roleType).toLowerCase()} entry '${state.participantRole.role.name}'.`,
    );
  }

  async function refreshAll({ quiet = false } = {}) {
    if (state.refreshInFlight) {
      return;
    }

    state.refreshInFlight = true;
    try {
      await refreshPublicMarket();
      await refreshParticipantRole();
      renderAll();
      if (!quiet) {
        log("Refreshed participant state.");
      }
    } catch (error) {
      renderAll();
      if (!quiet) {
        log(error.message);
      }
      throw error;
    } finally {
      state.refreshInFlight = false;
    }
  }

  async function passiveRefresh(failureMessage) {
    try {
      await refreshAll({ quiet: true });
    } catch (error) {
      log(`${failureMessage} ${error.message}`);
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
    updateDraftDirty();
    renderParticipantPanel();
  }

  function removeParticipantChoice(choiceId) {
    state.participantRankingOrder = state.participantRankingOrder.filter((item) => item !== choiceId);
    updateDraftDirty();
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
    updateDraftDirty();
    renderParticipantPanel();
  }

  async function submitParticipantRanking() {
    if (!state.participantRole) {
      log("Open your entry before submitting preferences.");
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
    state.draftDirty = false;
    await refreshPublicMarket();
    renderAll();
    log(`Submitted preferences for ${roleLabel(payload.roleType).toLowerCase()} '${payload.role.name}'.`);
  }

  function attachHandlers() {
    elements.refreshNow.addEventListener("click", async () => {
      try {
        await refreshAll();
      } catch (error) {
        // `refreshAll` already logged the error.
      }
    });

    elements.participantRoleType.addEventListener("change", () => {
      if (!state.participantRole) {
        renderAll();
      }
    });

    elements.participantName.addEventListener("input", () => {
      if (!state.participantRole) {
        renderAll();
      }
    });

    elements.participantChoiceSearch.addEventListener("input", (event) => {
      state.participantChoiceQuery = event.target.value;
      renderParticipantPanel();
    });

    elements.participantLoad.addEventListener("click", async () => {
      try {
        await registerParticipant();
        await refreshPublicMarket();
        renderAll();
      } catch (error) {
        renderAll();
        log(error.message);
      }
    });

    elements.participantReset.addEventListener("click", () => {
      clearActiveParticipant();
      renderAll();
      log("Cleared the active participant draft.");
    });

    elements.participantSubmit.addEventListener("click", async () => {
      try {
        await submitParticipantRanking();
      } catch (error) {
        renderAll();
        log(error.message);
      }
    });

    window.addEventListener("focus", () => {
      passiveRefresh("Automatic refresh failed.");
    });

    document.addEventListener("visibilitychange", () => {
      if (isDocumentVisible()) {
        passiveRefresh("Automatic refresh failed.");
      }
    });

    setInterval(() => {
      if (isDocumentVisible()) {
        passiveRefresh("Automatic refresh failed.");
      }
    }, AUTO_REFRESH_MS);

    document.body.addEventListener("click", (event) => {
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
