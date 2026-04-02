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
    participantSubmit: document.getElementById("participant-submit"),
    resultBadge: document.getElementById("result-badge"),
    resultSummaryGrid: document.getElementById("result-summary-grid"),
    resultBody: document.getElementById("result-body"),
    checkConnection: document.getElementById("check-connection"),
    refreshState: document.getElementById("refresh-state"),
    statusLog: document.getElementById("status-log"),
  };

  const state = {
    publicMarket: null,
    participantRole: null,
    participantRankingOrder: [],
    participantChoiceQuery: "",
  };

  const log = createLogger(elements.statusLog);

  function getRankingLimit() {
    return state.publicMarket?.rankingLimit || state.participantRole?.rankingLimit || 10;
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

    if (!market || !counts) {
      setBadge(elements.participantMarketBadge, "No market loaded", "muted");
    } else {
      setBadge(
        elements.participantMarketBadge,
        `${phaseLabel(phase)} · Hospitals ${counts.hospitalsSubmitted}/${counts.hospitalsTotal} · Students ${counts.candidatesSubmitted}/${counts.candidatesTotal}`,
        "",
      );
    }

    if (!state.participantRole) {
      elements.participantRoleTitle.textContent = "Choose your role and enter your name";
      if (!market) {
        elements.participantRoleMeta.textContent = "Check the connection and make sure the backend is reachable.";
        elements.participantRankingNote.textContent = "";
      } else if (phase === "registration_open") {
        elements.participantRoleMeta.textContent = "Register now to claim one role in the market.";
        elements.participantRankingNote.textContent = "Ranking opens only after the central office closes registration.";
      } else if (phase === "ranking_open") {
        elements.participantRoleMeta.textContent = "Registration is closed. Reopen your existing entry with the same role and name.";
        elements.participantRankingNote.textContent = "You can submit or revise your ranking during this phase.";
      } else {
        elements.participantRoleMeta.textContent = market.publishedRun
          ? "The market is locked. Reopen your existing entry to view your published personal outcome."
          : "The market is locked. Public submissions are closed until the central office reopens the market.";
        elements.participantRankingNote.textContent = "No new public submissions can be made while the market is locked.";
      }
      setBadge(elements.participantRoleBadge, "No entry", "muted");
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
      elements.participantRoleMeta.textContent = `${role.id}${capacityText}. Registration saved. Ranking will open after the central office closes registration.`;
      setBadge(elements.participantRoleBadge, "Registered", "ok");
      elements.participantRankingNote.textContent = "No rankings can be submitted during the registration phase.";
      elements.participantSubmit.disabled = true;
      renderParticipantPicker(null);
      return;
    }

    if (phase === "ranking_open") {
      elements.participantRoleMeta.textContent = `${role.id}${capacityText}. Choose up to ${getRankingLimit()} options in descending order. Last submission: ${formatDate(state.participantRole.submittedAt)}.`;
      setBadge(
        elements.participantRoleBadge,
        state.participantRole.submittedAt ? "Submitted" : "Ready to rank",
        state.participantRole.submittedAt ? "ok" : "warn",
      );
      elements.participantRankingNote.textContent = "Add up to ten options, then order them from best to worst.";
      elements.participantSubmit.disabled = state.participantRankingOrder.length === 0;
      renderParticipantPicker("ranking_open");
      return;
    }

    elements.participantRoleMeta.textContent = `${role.id}${capacityText}. The market is locked. Last submission: ${formatDate(state.participantRole.submittedAt)}.`;
    setBadge(
      elements.participantRoleBadge,
      state.participantRole.submittedAt ? "Locked" : "Locked without submission",
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
        summaryBox("Assigned", "Load your entry"),
      ].join("");
      elements.resultBody.innerHTML = `<p class="empty">Reopen your entry with the same role and name to view your personal published outcome.</p>`;
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

    const hasAssignments = Boolean(match && match.matches.length);
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

  async function refreshPublicMarket({ quiet = false } = {}) {
    state.publicMarket = await publicApi("/api/public/market", { method: "GET" });
    if (!quiet) {
      log("Public market refreshed.");
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
    await refreshParticipantRole({ quiet: true });
    renderAll();
    if (!quiet) {
      log("Refreshed participant state.");
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
    renderAll();
    log(`Submitted preferences for ${roleLabel(payload.roleType).toLowerCase()} '${payload.role.name}'.`);
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
