(function () {
  const {
    formatDate,
    phaseLabel,
    publicApi,
    roleLabel,
    setBadge,
    summaryBox,
  } = window.MatchingShared;

  const AUTO_REFRESH_MS = 30000;

  const elements = {
    bulletinBadge: document.getElementById("bulletin-badge"),
    bulletinSummaryGrid: document.getElementById("bulletin-summary-grid"),
    bulletinTitle: document.getElementById("bulletin-title"),
    bulletinMessage: document.getElementById("bulletin-message"),
  };

  const state = {
    publicMarket: null,
    refreshInFlight: false,
  };

  function isDocumentVisible() {
    return document.visibilityState !== "hidden";
  }

  function bulletinNotice(market) {
    if (!market) {
      return {
        badge: "Market status unavailable",
        tone: "warn",
        title: "Public status unavailable",
        message: "The page could not reach the public market service just now.",
      };
    }

    if (market.phase === "registration_open") {
      return {
        badge: "Registration is open",
        tone: "",
        title: "Registration is open",
        message: "Participants can open the participant page to claim one role in the market and create or reopen an entry.",
      };
    }

    if (market.phase === "ranking_open") {
      return {
        badge: "Rankings are open",
        tone: "",
        title: "Rankings are open",
        message: "Existing participants can reopen their entry, review their draft, and submit rankings now.",
      };
    }

    if (market.publishedRun) {
      return {
        badge: "Result published",
        tone: "ok",
        title: "Result published",
        message: "Participants can open their entry to see only their own published outcome.",
      };
    }

    return {
      badge: "Market locked",
      tone: "warn",
      title: "Matching is closed",
      message: "The market is locked. The central office has not published a result yet, so participants should wait.",
    };
  }

  function renderBulletin() {
    const market = state.publicMarket;
    const counts = market?.submissionCounts;
    const notice = bulletinNotice(market);

    setBadge(elements.bulletinBadge, notice.badge, notice.tone === undefined ? "muted" : notice.tone);
    elements.bulletinTitle.textContent = notice.title;
    elements.bulletinMessage.textContent = notice.message;

    if (!market || !counts) {
      elements.bulletinSummaryGrid.innerHTML = [
        summaryBox("Phase", "Unknown"),
        summaryBox("Hospitals", "n/a"),
        summaryBox("Students", "n/a"),
        summaryBox("Result", "Unavailable"),
      ].join("");
      return;
    }

    const publishedText = market.publishedRun
      ? `${roleLabel(market.publishedRun.proposerSide)}-proposing · ${formatDate(market.publishedRun.createdAt, "n/a")}`
      : "Not published";

    elements.bulletinSummaryGrid.innerHTML = [
      summaryBox("Phase", phaseLabel(market.phase)),
      summaryBox("Hospitals submitted", `${counts.hospitalsSubmitted}/${counts.hospitalsTotal}`),
      summaryBox("Students submitted", `${counts.candidatesSubmitted}/${counts.candidatesTotal}`),
      summaryBox("Result", publishedText),
    ].join("");
  }

  async function refreshBulletin() {
    const market = await publicApi("/api/public/market", { method: "GET" });
    state.publicMarket = market;
    renderBulletin();
  }

  async function passiveRefresh() {
    if (state.refreshInFlight) {
      return;
    }
    state.refreshInFlight = true;
    try {
      await refreshBulletin();
    } catch (error) {
      renderBulletin();
    } finally {
      state.refreshInFlight = false;
    }
  }

  function attachHandlers() {
    window.addEventListener("focus", passiveRefresh);
    document.addEventListener("visibilitychange", () => {
      if (isDocumentVisible()) {
        passiveRefresh();
      }
    });
    setInterval(() => {
      if (isDocumentVisible()) {
        passiveRefresh();
      }
    }, AUTO_REFRESH_MS);
  }

  async function init() {
    renderBulletin();
    attachHandlers();
    await passiveRefresh();
  }

  init();
}());
