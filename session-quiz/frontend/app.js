(function () {
  const { publicApi, escapeHtml, toast, fmtTimer } = window.QuizShared;

  const STORAGE_KEY = "session-quiz-student-v1";
  const FEEDBACK_KEY = "session-quiz-last-feedback-v1";

  const cards = {
    login: document.getElementById("card-login"),
    lobby: document.getElementById("card-lobby"),
    quiz: document.getElementById("card-quiz"),
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
    itemCount: 0,
  };

  let currentAttempt = null; // { id, options, ord, deadline_ms }
  let lobbyPollTimer = null;
  let timerInterval = null;
  let blurSent = false; // prevent double-fire per attempt
  let inFlight = null;  // current async to avoid double-actions
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
    state = { token: null, sessionId: null, joinCode: null, displayName: null,
              feedback: "immediate", swapPolicy: "soft", itemCount: 0 };
  }

  function saveFeedbackState(visibleIndex, result) {
    if (!currentAttempt) return;
    try {
      window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify({
        attemptId: currentAttempt.id,
        ord: currentAttempt.ord,
        itemCount: currentAttempt.itemCount,
        stem: currentAttempt.stem,
        options: currentAttempt.options,
        deadlineMs: currentAttempt.deadline_ms,
        chosenIndex: visibleIndex,
        correct: !!result.correct,
        explanation: result.explanation || "",
        correctOptionText: result.correct_option_text || "",
      }));
    } catch (_) { /* ignore */ }
  }

  function loadFeedbackState() {
    try {
      const raw = window.localStorage.getItem(FEEDBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearFeedbackState() {
    try { window.localStorage.removeItem(FEEDBACK_KEY); } catch (_) {}
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
      if (document.hidden) onBlur();
    });
    window.addEventListener("blur", onBlur);

    // Friction handlers.
    cards.quiz.addEventListener("copy", (e) => e.preventDefault());
    cards.quiz.addEventListener("cut", (e) => e.preventDefault());
    cards.quiz.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  async function resumeSession() {
    const status = await publicApi(
      `/quiz/live_status?student_token=${encodeURIComponent(state.token)}`
    );
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
      show("quiz");
      const cached = loadFeedbackState();
      if (cached) {
        renderCachedFeedback(cached);
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
        itemCount: result.item_count,
        rulesText: result.rules_text,
      };
      saveState();
      els.sessionName.textContent = result.display_name || "";
      els.lobbyRules.textContent = result.rules_text || "";
      if (result.status === "live") {
        show("quiz");
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
          show("quiz");
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

  async function fetchNext() {
    if (hardEnded) return;
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
    if (!result.correct && result.correct_option_text) {
      // Highlight the correct option too.
      els.quizOptions.querySelectorAll(".option").forEach((l) => {
        if (l.querySelector("span").textContent === result.correct_option_text) {
          l.classList.add("correct");
        }
      });
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
    // Persist for reload-recovery: a refresh between submit and Next
    // would otherwise skip past the explanation entirely.
    saveFeedbackState(visibleIndex, result);
  }

  function renderCachedFeedback(cached) {
    currentAttempt = {
      id: cached.attemptId,
      stem: cached.stem,
      options: cached.options,
      ord: cached.ord,
      itemCount: cached.itemCount,
      deadline_ms: cached.deadlineMs,
      remaining_ms: Math.max(0, cached.deadlineMs - Date.now()),
    };
    show("quiz");
    els.quizProgress.textContent =
      `Въпрос ${cached.ord || "—"} от ${cached.itemCount || state.itemCount || "—"}`;
    els.quizStem.textContent = cached.stem || "";
    els.quizOptions.innerHTML = cached.options.map((opt, idx) => `
      <li>
        <label class="option" data-idx="${idx}">
          <input type="radio" name="opt" value="${idx}" disabled />
          <span>${escapeHtml(opt)}</span>
        </label>
      </li>
    `).join("");
    const chosen = els.quizOptions.querySelector(`.option[data-idx="${cached.chosenIndex}"]`);
    if (chosen) {
      chosen.classList.add("selected", cached.correct ? "correct" : "wrong");
      const input = chosen.querySelector("input");
      if (input) input.checked = true;
    }
    if (!cached.correct && cached.correctOptionText) {
      els.quizOptions.querySelectorAll(".option").forEach((l) => {
        if (l.querySelector("span").textContent === cached.correctOptionText) {
          l.classList.add("correct");
        }
      });
    }
    lockOptions();
    els.quizFeedback.innerHTML = `
      <div class="feedback-chip ${cached.correct ? "correct" : "wrong"}">
        ${cached.correct ? "✓ Верен отговор." : "✗ Грешен отговор."}
        ${cached.explanation
          ? `<span class="explanation">${escapeHtml(cached.explanation)}</span>`
          : ""}
      </div>`;
    els.quizFeedback.hidden = false;
    els.quizSubmit.hidden = true;
    els.quizNext.hidden = false;
    startTimer();
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

  async function onBlur() {
    if (!currentAttempt) return;
    if (cards.quiz.hidden) return;
    if (blurSent) return;
    if (!els.quizSubmit.hidden && els.quizSubmit.disabled === false) {
      // active question with selection but not submitted — still swap
    }
    if (els.quizSubmit.hidden) {
      // already answered, awaiting Next; no need to blur-swap
      return;
    }
    blurSent = true;
    try {
      const result = await publicApi("/quiz/blur", {
        method: "POST",
        body: { attempt_id: currentAttempt.id },
      });
      if (result.session_ended) {
        hardEnded = true;
        showEnd({ reason: result.reason, score: null });
        return;
      }
      // Soft swap: server already invalidated this attempt; refetch.
      currentAttempt = null;
      fetchNext();
    } catch (_) {
      // Network may be flaky on tab switch; retry on next interaction.
      blurSent = false;
    }
  }

  // --- End screen -----------------------------------------------------------

  function showEnd(data) {
    stopTimer();
    stopLobbyPoll();
    clearFeedbackState();
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
