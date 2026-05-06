(function () {
  const { publicApi, escapeHtml, toast, fmtTimer, API_BASE } = window.QuizShared;

  const STORAGE_KEY = "session-quiz-student-v1";
  const FEEDBACK_KEY = "session-quiz-last-feedback-v1";
  const LOST_FOCUS_KEY = "session-quiz-lost-focus-v1";
  const STRICT_RESIZE_RATIO = 0.85;
  const STRICT_RESIZE_DEBOUNCE_MS = 750;

  const cards = {
    login: document.getElementById("card-login"),
    lobby: document.getElementById("card-lobby"),
    quiz: document.getElementById("card-quiz"),
    fullscreen: document.getElementById("card-fullscreen"),
    end: document.getElementById("card-end"),
  };

  const els = {
    sessionName: document.getElementById("session-name"),
    loginTitle: document.getElementById("login-title"),
    loginRules: document.getElementById("login-rules"),
    loginForm: document.getElementById("login-form"),
    loginCode: document.getElementById("login-code"),
    loginStudent: document.getElementById("login-student-number"),
    loginError: document.getElementById("login-error"),
    lobbyRules: document.getElementById("lobby-rules"),
    quizProgress: document.getElementById("quiz-progress"),
    quizTimer: document.getElementById("quiz-timer"),
    quizStem: document.getElementById("quiz-stem"),
    quizOptions: document.getElementById("quiz-options"),
    quizFeedback: document.getElementById("quiz-feedback"),
    quizSubmit: document.getElementById("quiz-submit"),
    quizNext: document.getElementById("quiz-next"),
    fullscreenEnter: document.getElementById("fullscreen-enter"),
    fullscreenMessage: document.getElementById("fullscreen-message"),
    fullscreenError: document.getElementById("fullscreen-error"),
    endHeadline: document.getElementById("end-headline"),
    endSummary: document.getElementById("end-summary"),
    endReasonNote: document.getElementById("end-reason-note"),
    endReset: document.getElementById("end-reset"),
  };

  let state = loadState() || {
    token: null,
    sessionId: null,
    joinCode: null,
    displayName: null,
    feedback: "immediate",
    swapPolicy: "soft",
    securityMode: "standard",
    itemCount: 0,
  };

  let currentAttempt = null; // { id, options, ord, deadline_ms }
  let lobbyPollTimer = null;
  let timerInterval = null;
  let blurSent = false; // prevent double-fire per attempt
  let inFlight = null;  // current async to avoid double-actions
  let focusRefreshInFlight = null;
  let resizeTimer = null;
  let fullscreenEverEntered = false;
  let hardEnded = false;

  // --- Storage --------------------------------------------------------------

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* ignore */ }
  }

  function clearState() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    clearFeedbackState();
    clearLostFocusState();
    state = { token: null, sessionId: null, joinCode: null, displayName: null,
              feedback: "immediate", swapPolicy: "soft",
              securityMode: "standard", itemCount: 0 };
  }

  function clearFeedbackState() {
    try { window.localStorage.removeItem(FEEDBACK_KEY); } catch (_) {}
  }

  function saveLostFocusState(attemptId) {
    if (!attemptId || !state.token) return;
    try {
      window.localStorage.setItem(LOST_FOCUS_KEY, JSON.stringify({
        attemptId,
        token: state.token,
        at: Date.now(),
      }));
    } catch (_) { /* ignore */ }
  }

  function loadLostFocusState() {
    try {
      const raw = window.localStorage.getItem(LOST_FOCUS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearLostFocusState(attemptId) {
    const marker = loadLostFocusState();
    if (attemptId && marker && marker.attemptId !== attemptId) return;
    try { window.localStorage.removeItem(LOST_FOCUS_KEY); } catch (_) {}
  }

  function hasLostFocusForAttempt(attemptId) {
    const marker = loadLostFocusState();
    return !!(marker && marker.token === state.token && marker.attemptId === attemptId);
  }

  // --- Card switching -------------------------------------------------------

  function show(name) {
    Object.entries(cards).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    if (name !== "lobby") stopLobbyPoll();
    if (name !== "quiz") stopTimer();
  }

  // --- Init -----------------------------------------------------------------

  function init() {
    const url = new URL(window.location.href);
    const codeFromUrl = (url.searchParams.get("code") || "").toUpperCase();
    if (codeFromUrl) {
      els.loginCode.value = codeFromUrl;
    }
    // If the URL targets a different session than the cached one,
    // prefer the URL — otherwise scanning a fresh QR would silently
    // replay the previous session's ended state.
    if (state && state.token && codeFromUrl && state.joinCode && codeFromUrl !== state.joinCode) {
      clearState();
      els.loginCode.value = codeFromUrl;
      show("login");
    } else if (state && state.token) {
      // Resume — try to fetch live status; on failure fall back to login.
      els.sessionName.textContent = state.displayName || "";
      resumeSession().catch(() => {
        clearState();
        show("login");
      });
    } else {
      show("login");
    }

    els.loginForm.addEventListener("submit", onLoginSubmit);
    els.fullscreenEnter.addEventListener("click", onEnterFullscreen);
    els.quizSubmit.addEventListener("click", onSubmitAnswer);
    els.quizNext.addEventListener("click", () => {
      // The cached feedback is now consumed; clear it before advancing
      // so a reload mid-fetch doesn't replay it.
      clearFeedbackState();
      fetchNext();
    });
    els.endReset.addEventListener("click", () => {
      clearState();
      hardEnded = false;
      els.loginCode.value = "";
      els.loginStudent.value = "";
      els.loginError.hidden = true;
      els.sessionName.textContent = "";
      show("login");
    });

    // Anti-cheat: blur swap.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) onFocusLost("visibility_hidden", { hidden: true });
      else onFocusReturn();
    });
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("mozfullscreenchange", onFullscreenChange);
    document.addEventListener("MSFullscreenChange", onFullscreenChange);
    window.addEventListener("blur", () => onFocusLost("window_blur"));
    window.addEventListener("focus", onFocusReturn);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("resize", onResize);

    // Friction handlers.
    cards.quiz.addEventListener("copy", (e) => e.preventDefault());
    cards.quiz.addEventListener("cut", (e) => e.preventDefault());
    cards.quiz.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  async function resumeSession() {
    // Always ask the server for the next authoritative state on re-entry.
    // Replaying cached feedback here can make a completed question look like
    // the current question has its correct answer pre-marked.
    clearFeedbackState();
    const status = await publicApi(
      `/quiz/live_status?student_token=${encodeURIComponent(state.token)}`
    );
    state.securityMode = status.security_mode || state.securityMode || "standard";
    saveState();
    if (status.ended) {
      showEnd({ reason: status.end_reason, score: null });
      return;
    }
    if (status.status === "lobby") {
      els.lobbyRules.textContent = state.rulesText || "";
      show("lobby");
      startLobbyPoll();
      return;
    }
    if (status.status === "live") {
      const ended = await resolveLostFocusBeforeNext();
      if (ended === true) return;
      if (ended === null) {
        toast("Въпросът ще се смени, когато връзката се възстанови.", "error");
        return;
      }
      fetchNext();
      return;
    }
    if (status.status === "closed") {
      showEnd({ reason: "instructor_closed", score: null });
      return;
    }
    show("login");
  }

  // --- Login ----------------------------------------------------------------

  async function onLoginSubmit(event) {
    event.preventDefault();
    els.loginError.hidden = true;
    const code = els.loginCode.value.trim().toUpperCase();
    const studentNumber = els.loginStudent.value.trim();
    if (!code || !studentNumber) return;
    try {
      const result = await publicApi("/quiz/join", {
        method: "POST",
        body: { code, student_number: studentNumber },
      });
      state = {
        token: result.student_token,
        sessionId: result.session_id,
        joinCode: result.join_code,
        displayName: result.display_name,
        feedback: result.feedback,
        swapPolicy: result.swap_policy,
        securityMode: result.security_mode || "standard",
        itemCount: result.item_count,
        rulesText: result.rules_text,
      };
      clearLostFocusState();
      saveState();
      els.sessionName.textContent = result.display_name || "";
      els.lobbyRules.textContent = result.rules_text || "";
      if (result.status === "live") {
        fetchNext();
      } else if (result.status === "closed") {
        showEnd({ reason: "instructor_closed", score: null });
      } else {
        show("lobby");
        startLobbyPoll();
      }
    } catch (err) {
      els.loginError.textContent = err.message || "Грешка при влизане.";
      els.loginError.hidden = false;
    }
  }

  // --- Lobby polling --------------------------------------------------------

  function startLobbyPoll() {
    stopLobbyPoll();
    lobbyPollTimer = setInterval(async () => {
      try {
        const s = await publicApi(
          `/quiz/live_status?student_token=${encodeURIComponent(state.token)}`
        );
        if (s.ended) {
          showEnd({ reason: s.end_reason, score: null });
        } else if (s.status === "live") {
          state.securityMode = s.security_mode || state.securityMode || "standard";
          saveState();
          fetchNext();
        } else if (s.status === "closed") {
          showEnd({ reason: "instructor_closed", score: null });
        }
      } catch (_) { /* keep trying */ }
    }, 3000);
  }

  function stopLobbyPoll() {
    if (lobbyPollTimer) {
      clearInterval(lobbyPollTimer);
      lobbyPollTimer = null;
    }
  }

  // --- Quiz: fetch next, render, submit, blur ------------------------------

  function isStrictMode() {
    return state.securityMode === "strict";
  }

  function fullscreenElement() {
    return document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null;
  }

  function isFullscreenActive() {
    return !!fullscreenElement();
  }

  function requestFullscreenTarget() {
    const target = document.documentElement;
    return target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      target.mozRequestFullScreen ||
      target.msRequestFullscreen ||
      null;
  }

  function fullscreenSupported() {
    const enabledFlags = [
      document.fullscreenEnabled,
      document.webkitFullscreenEnabled,
      document.mozFullScreenEnabled,
      document.msFullscreenEnabled,
    ].filter((value) => typeof value === "boolean");
    if (enabledFlags.length && !enabledFlags.some(Boolean)) return false;
    return !!requestFullscreenTarget();
  }

  function showFullscreenGate(reason) {
    els.fullscreenError.hidden = true;
    els.fullscreenError.textContent = "";
    if (!fullscreenSupported()) {
      els.fullscreenEnter.disabled = true;
      els.fullscreenError.textContent =
        "Това устройство или браузър не поддържа режим на цял екран. Свържете се с преподавателя.";
      els.fullscreenError.hidden = false;
    } else {
      els.fullscreenEnter.disabled = false;
    }
    els.fullscreenMessage.textContent = reason ||
      "Напускането на цял екран или промяна на прозореца сменя текущия въпрос.";
    show("fullscreen");
  }

  async function onEnterFullscreen() {
    els.fullscreenError.hidden = true;
    if (!fullscreenSupported()) {
      showFullscreenGate();
      return;
    }
    try {
      const request = requestFullscreenTarget();
      await request.call(document.documentElement);
      fullscreenEverEntered = true;
      fetchNext();
    } catch (_) {
      els.fullscreenError.textContent =
        "Неуспешно влизане в цял екран. Разрешете fullscreen, за да започнете теста.";
      els.fullscreenError.hidden = false;
    }
  }

  function requireFullscreenBeforeQuestion() {
    if (!isStrictMode()) return false;
    if (isFullscreenActive()) {
      fullscreenEverEntered = true;
      return false;
    }
    showFullscreenGate();
    return true;
  }

  async function fetchNext() {
    if (hardEnded) return;
    const marker = loadLostFocusState();
    if (marker && marker.token === state.token) {
      if (document.hidden) return;
      const ended = await resolveLostFocusBeforeNext();
      if (ended === true || ended === null) return;
      currentAttempt = null;
    }
    if (requireFullscreenBeforeQuestion()) return;
    if (inFlight) return;
    inFlight = (async () => {
      try {
        const data = await publicApi(
          `/quiz/next?student_token=${encodeURIComponent(state.token)}`
        );
        if (data.session_status === "lobby") {
          show("lobby");
          startLobbyPoll();
          return;
        }
        if (data.session_ended) {
          showEnd(data);
          return;
        }
        if (data.security_mode) {
          state.securityMode = data.security_mode;
          saveState();
        }
        renderAttempt(data);
      } catch (err) {
        toast(err.message || "Грешка при зареждане на въпроса.", "error");
      }
    })();
    try { await inFlight; } finally { inFlight = null; }
  }

  function renderAttempt(data) {
    blurSent = false;
    currentAttempt = {
      id: data.attempt_id,
      stem: data.stem || "",
      options: data.options,
      ord: data.ord,
      itemCount: data.item_count || state.itemCount,
      deadline_ms: Date.now() + (data.remaining_ms || 0),
      remaining_ms: data.remaining_ms || 0,
    };
    show("quiz");
    els.quizProgress.textContent = `Въпрос ${data.ord || "—"} от ${data.item_count || state.itemCount || "—"}`;
    els.quizStem.textContent = data.stem || "";
    els.quizOptions.innerHTML = data.options.map((opt, idx) => `
      <li>
        <label class="option" data-idx="${idx}">
          <input type="radio" name="opt" value="${idx}" />
          <span>${escapeHtml(opt)}</span>
        </label>
      </li>
    `).join("");
    els.quizOptions.querySelectorAll(".option").forEach((label) => {
      label.addEventListener("click", onOptionClick);
    });
    els.quizFeedback.hidden = true;
    els.quizFeedback.innerHTML = "";
    els.quizSubmit.disabled = true;
    els.quizSubmit.hidden = false;
    els.quizNext.hidden = true;
    startTimer();
  }

  function onOptionClick(event) {
    const label = event.currentTarget;
    const idx = Number(label.dataset.idx);
    els.quizOptions.querySelectorAll(".option").forEach((l) => {
      l.classList.toggle("selected", Number(l.dataset.idx) === idx);
      const input = l.querySelector("input");
      if (input) input.checked = Number(l.dataset.idx) === idx;
    });
    els.quizSubmit.disabled = false;
  }

  async function onSubmitAnswer() {
    if (!currentAttempt) return;
    if (hasLostFocusForAttempt(currentAttempt.id)) {
      els.quizSubmit.disabled = true;
      toast("Въпросът се сменя след напускане на страницата.", "error");
      forceRefreshAfterFocusLoss();
      return;
    }
    const selected = els.quizOptions.querySelector(".option.selected");
    if (!selected) return;
    const visibleIndex = Number(selected.dataset.idx);
    els.quizSubmit.disabled = true;
    try {
      const result = await publicApi("/quiz/answer", {
        method: "POST",
        body: { attempt_id: currentAttempt.id,
                chosen_visible_index: visibleIndex },
      });
      if (result.session_ended) {
        showEnd(result);
        return;
      }
      lockOptions();
      if (state.feedback === "immediate") {
        renderImmediateFeedback(result, visibleIndex);
      } else {
        // Auto-advance silently for end_of_session feedback.
        setTimeout(fetchNext, 200);
      }
    } catch (err) {
      els.quizSubmit.disabled = false;
      toast(err.message || "Грешка при изпращане на отговора.", "error");
    }
  }

  function lockOptions() {
    els.quizOptions.querySelectorAll(".option").forEach((l) => {
      l.classList.add("disabled");
      const input = l.querySelector("input");
      if (input) input.disabled = true;
    });
  }

  function renderImmediateFeedback(result, visibleIndex) {
    const selected = els.quizOptions.querySelector(`.option[data-idx="${visibleIndex}"]`);
    if (selected) selected.classList.add(result.correct ? "correct" : "wrong");
    if (!result.correct) {
      const correctIndex = Number(result.correct_visible_index);
      const correctOption = Number.isInteger(correctIndex)
        ? els.quizOptions.querySelector(`.option[data-idx="${correctIndex}"]`)
        : null;
      if (correctOption) {
        correctOption.classList.add("correct");
      } else if (result.correct_option_text) {
        // Backward-compatible fallback for older backend responses.
        els.quizOptions.querySelectorAll(".option").forEach((l) => {
          if (l.querySelector("span").textContent === result.correct_option_text) {
            l.classList.add("correct");
          }
        });
      }
    }
    els.quizFeedback.innerHTML = `
      <div class="feedback-chip ${result.correct ? "correct" : "wrong"}">
        ${result.correct ? "✓ Верен отговор." : "✗ Грешен отговор."}
        ${result.explanation
          ? `<span class="explanation">${escapeHtml(result.explanation)}</span>`
          : ""}
      </div>`;
    els.quizFeedback.hidden = false;
    els.quizSubmit.hidden = true;
    els.quizNext.hidden = false;
    els.quizNext.focus();
  }

  // --- Timer ----------------------------------------------------------------

  function startTimer() {
    stopTimer();
    updateTimer();
    timerInterval = setInterval(updateTimer, 500);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function updateTimer() {
    if (!currentAttempt) return;
    const remaining = Math.max(0, currentAttempt.deadline_ms - Date.now());
    els.quizTimer.textContent = fmtTimer(remaining);
    els.quizTimer.classList.toggle("low", remaining < 60_000);
    if (remaining <= 0) {
      stopTimer();
      // Server will mark time_up on next call; ask now.
      fetchNext();
    }
  }

  // --- Blur swap ------------------------------------------------------------

  function apiUrl(path) {
    return `${String(API_BASE || "").replace(/\/$/, "")}${path}`;
  }

  function incidentMetadata(extra = {}) {
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenWidth: window.screen ? window.screen.width : null,
      screenHeight: window.screen ? window.screen.height : null,
      hidden: document.hidden,
      fullscreen: isFullscreenActive(),
      userAgent: navigator.userAgent,
      ...extra,
    };
  }

  function incidentPayload(eventType, attemptId, metadata = {}) {
    return {
      student_token: state.token,
      attempt_id: attemptId || null,
      event_type: eventType,
      client_ts: Date.now(),
      metadata: incidentMetadata(metadata),
    };
  }

  function sendIncidentBeacon(eventType, attemptId, metadata = {}) {
    if (!isStrictMode() || !state.token || !navigator.sendBeacon) return false;
    try {
      const body = JSON.stringify(incidentPayload(eventType, attemptId, metadata));
      const blob = new Blob([body], { type: "application/json" });
      return navigator.sendBeacon(apiUrl("/quiz/incident"), blob);
    } catch (_) {
      return false;
    }
  }

  function logIncident(eventType, attemptId, metadata = {}) {
    if (!isStrictMode() || !state.token) return;
    fetch(apiUrl("/quiz/incident"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(incidentPayload(eventType, attemptId, metadata)),
      keepalive: true,
    }).catch(() => { /* incident logging should not block the quiz flow */ });
  }

  function shouldLogTrustEvent() {
    return !!(
      isStrictMode() &&
      state.token &&
      !hardEnded &&
      cards.login.hidden &&
      cards.lobby.hidden &&
      cards.end.hidden
    );
  }

  function logTrustEvent(eventType, attemptId, metadata = {}, preferBeacon = false) {
    if (!shouldLogTrustEvent()) return;
    if (preferBeacon && sendIncidentBeacon(eventType, attemptId, metadata)) return;
    logIncident(eventType, attemptId, metadata);
  }

  function canInvalidateCurrentAttempt() {
    return !!(
      currentAttempt &&
      !cards.quiz.hidden &&
      !els.quizSubmit.hidden
    );
  }

  function sendBlurBeacon(attemptId) {
    if (!navigator.sendBeacon) return false;
    try {
      const body = JSON.stringify({ attempt_id: attemptId });
      const blob = new Blob([body], { type: "application/json" });
      return navigator.sendBeacon(apiUrl("/quiz/blur"), blob);
    } catch (_) {
      return false;
    }
  }

  async function postBlur(attemptId) {
    const response = await fetch(apiUrl("/quiz/blur"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attempt_id: attemptId }),
      keepalive: true,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    return payload;
  }

  function handleBlurResult(result, attemptId) {
    clearLostFocusState(attemptId);
    if (result.session_ended) {
      hardEnded = true;
      showEnd({ reason: result.reason, score: null });
      return true;
    }
    return false;
  }

  async function resolveLostFocusBeforeNext() {
    const marker = loadLostFocusState();
    if (!marker || marker.token !== state.token) return false;
    try {
      const result = await postBlur(marker.attemptId);
      return handleBlurResult(result, marker.attemptId);
    } catch (_) {
      return null;
    }
  }

  function forceRefreshAfterFocusLoss() {
    if (focusRefreshInFlight) return focusRefreshInFlight;
    focusRefreshInFlight = (async () => {
      const ended = await resolveLostFocusBeforeNext();
      if (ended === null) {
        toast("Въпросът ще се смени, когато връзката се възстанови.", "error");
        return;
      }
      if (!ended && !hardEnded) {
        currentAttempt = null;
        await fetchNext();
      }
    })();
    focusRefreshInFlight.finally(() => {
      focusRefreshInFlight = null;
    });
    return focusRefreshInFlight;
  }

  function onFocusLost(eventType = "window_blur", metadata = {}) {
    const attemptId = currentAttempt ? currentAttempt.id : null;
    if (!canInvalidateCurrentAttempt()) {
      logTrustEvent(eventType, attemptId, metadata, document.hidden);
      return;
    }
    if (blurSent) return;
    saveLostFocusState(attemptId);
    logTrustEvent(eventType, attemptId, metadata, document.hidden);
    blurSent = true;

    if (document.hidden && sendBlurBeacon(attemptId)) {
      return;
    }

    postBlur(attemptId)
      .then((result) => {
        if (handleBlurResult(result, attemptId)) return;
        currentAttempt = null;
        if (document.hidden) return;
        fetchNext();
      })
      .catch(() => {
        // Keep the local lost-focus marker. Submission is blocked until the
        // client can resolve it on focus or before the next answer.
        blurSent = false;
      });
  }

  function onFocusReturn() {
    const marker = loadLostFocusState();
    if (marker && marker.token === state.token) {
      forceRefreshAfterFocusLoss();
      return;
    }
    if (
      isStrictMode() && !isFullscreenActive() && state.token && !hardEnded &&
      cards.login.hidden && cards.lobby.hidden && cards.end.hidden
    ) {
      showFullscreenGate();
      return;
    }
    if (!cards.quiz.hidden && !currentAttempt && state.token && !hardEnded) {
      fetchNext();
    }
  }

  function onPageHide() {
    const attemptId = currentAttempt ? currentAttempt.id : null;
    logTrustEvent("pagehide", attemptId, {}, true);
    if (!canInvalidateCurrentAttempt()) return;
    saveLostFocusState(attemptId);
    sendBlurBeacon(attemptId);
  }

  function onFullscreenChange() {
    if (!isStrictMode()) return;
    if (isFullscreenActive()) {
      fullscreenEverEntered = true;
      return;
    }
    if (!fullscreenEverEntered && !currentAttempt) return;
    if (canInvalidateCurrentAttempt()) {
      onFocusLost("fullscreen_exit");
    } else {
      logIncident("fullscreen_exit", currentAttempt ? currentAttempt.id : null);
    }
    showFullscreenGate("Върнете се в режим на цял екран, за да продължите.");
  }

  function onResize() {
    if (!isStrictMode() || !fullscreenEverEntered || hardEnded) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(checkSuspiciousResize, STRICT_RESIZE_DEBOUNCE_MS);
  }

  function checkSuspiciousResize() {
    resizeTimer = null;
    if (!isStrictMode() || !fullscreenEverEntered || hardEnded) return;
    if (!currentAttempt || !isFullscreenActive()) return;
    const sw = window.screen ? window.screen.width : window.innerWidth;
    const sh = window.screen ? window.screen.height : window.innerHeight;
    if (!sw || !sh) return;
    const widthRatio = Math.max(window.innerWidth / sw, window.innerWidth / sh);
    const heightRatio = Math.max(window.innerHeight / sw, window.innerHeight / sh);
    if (widthRatio < STRICT_RESIZE_RATIO || heightRatio < STRICT_RESIZE_RATIO) {
      onFocusLost("suspicious_resize", {
        widthRatio: Math.round(widthRatio * 1000) / 1000,
        heightRatio: Math.round(heightRatio * 1000) / 1000,
      });
      showFullscreenGate("Размерът на прозореца се промени. Влезте отново в цял екран.");
    }
  }

  // --- End screen -----------------------------------------------------------

  function showEnd(data) {
    stopTimer();
    stopLobbyPoll();
    clearFeedbackState();
    clearLostFocusState();
    show("end");
    const reason = data.reason || "completed";
    const score = data.score;
    const headlines = {
      completed: "Готово.",
      time_up: "Времето изтече.",
      exhausted: "Готово.",
      blur_hard: "Сесията приключи.",
      instructor_closed: "Тестът е затворен.",
    };
    els.endHeadline.textContent = headlines[reason] || "Готово.";
    if (score && score.answered > 0) {
      // Denominator = answered, not item_count: a student who only saw
      // 9 of 30 (e.g. exhausted/time_up) shouldn't be told "X of 30".
      els.endSummary.textContent =
        `${score.correct} от ${score.answered} верни отговора.`;
    } else if (score) {
      els.endSummary.textContent = "Не сте отговорили на нито един въпрос.";
    } else {
      els.endSummary.textContent = "Резултатите ще бъдат обявени от преподавателя.";
    }
    const reasonNotes = {
      blur_hard: "Сесията приключи, защото излязохте от страницата.",
      time_up: "Изтече предвиденото време.",
      exhausted: "Изчерпани са въпросите от темата.",
      instructor_closed: "Преподавателят затвори сесията.",
    };
    els.endReasonNote.textContent = reasonNotes[reason] || "";
  }

  init();
})();
