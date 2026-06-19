(function () {
  const { adminApi, request, escapeHtml, toast, fmtTimer, fmtDate, API_BASE } = window.QuizShared;

  const KEY_STORAGE = "session-quiz-admin-key-v1";
  const ACTIVE_SESSION_STORAGE = "session-quiz-active-session-v1";
  const BANKS_EMPTY_TEXT = "Все още няма качени банки.";
  const SESSIONS_EMPTY_TEXT = "Няма сесии.";

  let adminKey = "";
  let activeSessionId = null;
  let livePollTimer = null;
  let banksCache = [];
  let qrLoadedFor = null;

  // ---- Element refs --------------------------------------------------------

  const els = {
    keyStatus: document.getElementById("admin-key-status"),
    keyBtn: document.getElementById("admin-key-set"),
    keyDialog: document.getElementById("admin-key-dialog"),
    keyForm: document.getElementById("admin-key-form"),
    keyInput: document.getElementById("admin-key-input"),
    keyCancel: document.getElementById("admin-key-cancel"),
    keyClear: document.getElementById("admin-key-clear"),
    tabs: document.querySelectorAll(".tab-btn"),
    tabSessions: document.getElementById("tab-sessions"),
    tabBanks: document.getElementById("tab-banks"),

    livePanel: document.getElementById("live-panel"),
    liveTitle: document.getElementById("live-title"),
    liveMeta: document.getElementById("live-meta"),
    liveCode: document.getElementById("live-code"),
    liveStatusLine: document.getElementById("live-status-line"),
    liveQr: document.getElementById("live-qr"),
    liveStart: document.getElementById("live-start"),
    liveClose: document.getElementById("live-close"),
    statStudents: document.getElementById("stat-students"),
    statElapsed: document.getElementById("stat-elapsed"),
    statRemaining: document.getElementById("stat-remaining"),
    liveStudents: document.getElementById("live-students").querySelector("tbody"),
    liveEmpty: document.getElementById("live-empty"),

    createForm: document.getElementById("create-form"),
    cfBank: document.getElementById("cf-bank"),
    cfTags: document.getElementById("cf-tags"),
    cfTagSummary: document.getElementById("cf-tag-summary"),
    cfTagsAll: document.getElementById("cf-tags-all"),
    cfTagsNone: document.getElementById("cf-tags-none"),
    cfDisplayName: document.getElementById("cf-display-name"),
    cfItemCount: document.getElementById("cf-item-count"),
    cfDuration: document.getElementById("cf-duration"),
    cfSwap: document.getElementById("cf-swap"),
    cfPermutation: document.getElementById("cf-permutation"),
    cfFeedback: document.getElementById("cf-feedback"),
    cfExhaustion: document.getElementById("cf-exhaustion"),
    cfSecurity: document.getElementById("cf-security"),

    sessionsTable: document.getElementById("sessions-table").querySelector("tbody"),
    sessionsEmpty: document.getElementById("sessions-empty"),

    uploadForm: document.getElementById("upload-form"),
    upFile: document.getElementById("up-file"),
    upName: document.getElementById("up-name"),
    uploadResult: document.getElementById("upload-result"),

    banksTable: document.getElementById("banks-table").querySelector("tbody"),
    banksEmpty: document.getElementById("banks-empty"),
  };

  // ---- Init ---------------------------------------------------------------

  function init() {
    adminKey = loadKey();
    activeSessionId = loadActiveSession();
    refreshKeyStatus();

    els.keyBtn.addEventListener("click", openKeyDialog);
    els.keyForm.addEventListener("submit", onKeyDialogSubmit);
    els.keyCancel.addEventListener("click", closeKeyDialog);
    els.keyClear.addEventListener("click", clearKey);
    els.keyDialog.addEventListener("close", () => { els.keyInput.value = ""; });
    els.tabs.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

    els.createForm.addEventListener("submit", onCreateSession);
    els.cfBank.addEventListener("change", onBankChange);
    els.cfItemCount.addEventListener("input", updateTagSummary);
    els.cfExhaustion.addEventListener("change", updateTagSummary);
    els.cfTagsAll.addEventListener("click", () => setAllTags(true));
    els.cfTagsNone.addEventListener("click", () => setAllTags(false));
    els.uploadForm.addEventListener("submit", onUpload);

    els.liveStart.addEventListener("click", onStartSession);
    els.liveClose.addEventListener("click", onCloseSession);

    refreshAll();
  }

  function loadKey() {
    try { return window.localStorage.getItem(KEY_STORAGE) || ""; }
    catch (_) { return ""; }
  }
  function saveKey(k) {
    try {
      if (k) window.localStorage.setItem(KEY_STORAGE, k);
      else window.localStorage.removeItem(KEY_STORAGE);
    } catch (_) { /* ignore */ }
  }
  function loadActiveSession() {
    try { return window.localStorage.getItem(ACTIVE_SESSION_STORAGE) || null; }
    catch (_) { return null; }
  }
  function saveActiveSession(id) {
    try {
      if (id) window.localStorage.setItem(ACTIVE_SESSION_STORAGE, id);
      else window.localStorage.removeItem(ACTIVE_SESSION_STORAGE);
    } catch (_) { /* ignore */ }
  }

  function openKeyDialog() {
    els.keyInput.value = adminKey;
    if (typeof els.keyDialog.showModal === "function") {
      els.keyDialog.showModal();
    } else {
      els.keyDialog.setAttribute("open", "");
    }
    window.setTimeout(() => {
      els.keyInput.focus();
      els.keyInput.select();
    }, 0);
  }

  function closeKeyDialog() {
    if (typeof els.keyDialog.close === "function" && els.keyDialog.open) {
      els.keyDialog.close();
    } else {
      els.keyDialog.removeAttribute("open");
      els.keyInput.value = "";
    }
  }

  function onKeyDialogSubmit(event) {
    event.preventDefault();
    adminKey = els.keyInput.value.trim();
    saveKey(adminKey);
    refreshKeyStatus();
    closeKeyDialog();
    refreshAll();
  }

  function clearKey() {
    adminKey = "";
    saveKey("");
    refreshKeyStatus();
    closeKeyDialog();
    refreshAll();
  }

  function refreshKeyStatus() {
    if (adminKey) {
      els.keyStatus.textContent = "key: ●●●●";
      els.keyStatus.style.color = "var(--ok)";
    } else {
      els.keyStatus.textContent = "key: not set";
      els.keyStatus.style.color = "var(--muted)";
    }
  }

  // ---- Tabs ---------------------------------------------------------------

  function switchTab(name) {
    els.tabs.forEach((b) => b.classList.toggle("current", b.dataset.tab === name));
    els.tabSessions.hidden = name !== "sessions";
    els.tabBanks.hidden = name !== "banks";
    if (name === "banks") refreshBanks();
  }

  // ---- Refresh dispatch ----------------------------------------------------

  async function refreshAll() {
    await refreshBanks();
    await refreshSessions();
    if (activeSessionId) {
      startLivePoll();
    }
  }

  // ---- Banks --------------------------------------------------------------

  async function refreshBanks() {
    try {
      const data = await adminApi("/quiz/admin/bank/list", adminKey);
      banksCache = data.banks || [];
      renderBanks(banksCache);
      renderBankSelect(banksCache);
    } catch (err) {
      banksCache = [];
      renderBanks([]);
      renderBankSelect([]);
      els.banksEmpty.hidden = false;
      els.banksEmpty.textContent = `Грешка при зареждане на банките: ${err.message}`;
      if (adminKey) toast(`Зареждането на банките не успя: ${err.message}`, "error");
    }
  }

  function renderBanks(banks) {
    els.banksEmpty.textContent = BANKS_EMPTY_TEXT;
    els.banksEmpty.hidden = banks.length > 0;
    els.banksTable.innerHTML = banks.map((b) => `
      <tr>
        <td>
          <strong>${escapeHtml(b.name)}</strong>
          <div class="hint">${escapeHtml(b.source_filename || "")}</div>
        </td>
        <td>${escapeHtml(fmtDate(b.uploaded_at))}</td>
        <td>${b.item_count}</td>
        <td>${(b.tags || []).map((t) => `${escapeHtml(t)} <span class="badge muted">${b.tag_counts[t] || 0}</span>`).join("<br>")}</td>
        <td><button class="button danger" data-bank-id="${escapeHtml(b.bank_id)}" data-action="delete-bank" type="button">Изтрий</button></td>
      </tr>
    `).join("");
    els.banksTable.querySelectorAll('[data-action="delete-bank"]').forEach((btn) => {
      btn.addEventListener("click", () => onDeleteBank(btn.dataset.bankId));
    });
  }

  function renderBankSelect(banks) {
    const prev = els.cfBank.value;
    els.cfBank.innerHTML = `<option value="">— избери —</option>` +
      banks.map((b) => `<option value="${escapeHtml(b.bank_id)}">${escapeHtml(b.name)} (${b.item_count})</option>`).join("");
    if (prev && banks.some((b) => b.bank_id === prev)) {
      els.cfBank.value = prev;
      onBankChange();
    } else {
      renderTagPicker(null);
    }
  }

  function onBankChange() {
    const id = els.cfBank.value;
    const bank = banksCache.find((b) => b.bank_id === id);
    renderTagPicker(bank);
  }

  function renderTagPicker(bank) {
    if (!bank) {
      els.cfTags.innerHTML = "";
      els.cfTagSummary.textContent = "Първо изберете банка.";
      els.cfTagSummary.classList.remove("pool-warning");
      return;
    }
    const tags = bank.tags || [];
    els.cfTags.innerHTML = tags.map((t, idx) => `
      <label class="tag-check">
        <input type="checkbox" value="${escapeHtml(t)}" ${idx === 0 ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(t)}</strong>
          <small>${bank.tag_counts[t] || 0} въпроса</small>
        </span>
      </label>
    `).join("");
    els.cfTags.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener("change", updateTagSummary);
    });
    updateTagSummary();
  }

  function selectedTags() {
    return Array.from(els.cfTags.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => input.value);
  }

  function setAllTags(checked) {
    els.cfTags.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = checked;
    });
    updateTagSummary();
  }

  function currentBank() {
    return banksCache.find((b) => b.bank_id === els.cfBank.value) || null;
  }

  function updateTagSummary() {
    const bank = currentBank();
    const tags = selectedTags();
    els.cfTagSummary.classList.remove("pool-warning");
    if (!bank) {
      els.cfTagSummary.textContent = "Първо изберете банка.";
      return;
    }
    if (!tags.length) {
      els.cfTagSummary.textContent = "Изберете поне една тема.";
      els.cfTagSummary.classList.add("pool-warning");
      return;
    }
    const poolSize = tags.reduce((sum, tag) => sum + (bank.tag_counts[tag] || 0), 0);
    const requested = Number(els.cfItemCount.value || 0);
    const suffix = tags.length === 1 ? "тема" : "теми";
    if (poolSize > 0 && requested > poolSize) {
      els.cfTagSummary.classList.add("pool-warning");
      if (els.cfExhaustion.value === "recycle") {
        els.cfTagSummary.textContent =
          `${poolSize} уникални въпроса в ${tags.length} ${suffix}; след това ще се повтарят.`;
      } else {
        els.cfTagSummary.textContent =
          `${poolSize} уникални въпроса в ${tags.length} ${suffix}; заявени са ${requested}, затова тестът може да приключи по-рано.`;
      }
      return;
    }
    els.cfTagSummary.textContent =
      `${poolSize} уникални въпроса в ${tags.length} ${suffix}.`;
  }

  async function onUpload(event) {
    event.preventDefault();
    const file = els.upFile.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (els.upName.value.trim()) fd.append("name", els.upName.value.trim());
    els.uploadResult.textContent = "Качване…";
    try {
      const result = await request("/quiz/admin/bank/upload", {
        method: "POST",
        formData: fd,
        adminKey,
      });
      const lines = [
        `✓ Качени ${result.item_count} въпроса под "${result.name}".`,
        `Теми: ${(result.tags || []).join(", ")}.`,
      ];
      if (result.warnings && result.warnings.length) {
        lines.push("Предупреждения:");
        for (const w of result.warnings) lines.push("  • " + w);
      }
      els.uploadResult.textContent = lines.join("\n");
      els.uploadResult.style.whiteSpace = "pre-wrap";
      els.uploadForm.reset();
      await refreshBanks();
      if (result.bank_id && banksCache.some((b) => b.bank_id === result.bank_id)) {
        els.cfBank.value = result.bank_id;
        onBankChange();
      }
    } catch (err) {
      els.uploadResult.textContent = "✗ " + (err.message || "Грешка при качване.");
      toast(err.message || "Качването не успя.", "error");
    }
  }

  async function onDeleteBank(bankId) {
    if (!window.confirm("Изтриване на банката? Това не може да се отмени.")) return;
    try {
      await adminApi(`/quiz/admin/bank/${encodeURIComponent(bankId)}`, adminKey, { method: "DELETE" });
      toast("Банката е изтрита.", "ok");
      refreshBanks();
    } catch (err) {
      toast(err.message || "Изтриването не успя.", "error");
    }
  }

  // ---- Sessions list -------------------------------------------------------

  async function refreshSessions() {
    try {
      const data = await adminApi("/quiz/admin/session/list", adminKey);
      renderSessions(data.sessions || []);
    } catch (err) {
      renderSessions([]);
      els.sessionsEmpty.hidden = false;
      els.sessionsEmpty.textContent = `Грешка при зареждане на сесиите: ${err.message}`;
      if (adminKey) toast(`Зареждането на сесиите не успя: ${err.message}`, "error");
    }
  }

  function sessionTagLabel(session) {
    if (Array.isArray(session.lecture_tags) && session.lecture_tags.length) {
      return session.lecture_tags.join(" + ");
    }
    return session.lecture_tag || "";
  }

  function renderSessions(sessions) {
    els.sessionsEmpty.textContent = SESSIONS_EMPTY_TEXT;
    els.sessionsEmpty.hidden = sessions.length > 0;
    els.sessionsTable.innerHTML = sessions.map((s) => {
      const statusBadge = ({
        lobby: '<span class="badge warn">lobby</span>',
        live: '<span class="badge ok">live</span>',
        closed: '<span class="badge muted">closed</span>',
        setup: '<span class="badge muted">setup</span>',
      })[s.status] || s.status;
      const isActive = s.session_id === activeSessionId;
      return `
        <tr ${isActive ? 'style="background: rgba(13,106,110,0.06);"' : ""}>
          <td><strong>${escapeHtml(s.join_code)}</strong></td>
          <td>${escapeHtml(s.display_name)}<div class="hint">${escapeHtml(sessionTagLabel(s))}</div></td>
          <td>${statusBadge}</td>
          <td>${s.students || 0}</td>
          <td>${escapeHtml(fmtDate(s.created_at))}</td>
          <td>
            <div class="row compact">
              <button class="button" data-action="open-session" data-id="${escapeHtml(s.session_id)}" type="button">Отвори</button>
              <button class="button" data-action="export" data-id="${escapeHtml(s.session_id)}" data-code="${escapeHtml(s.join_code)}" type="button">Excel</button>
              <button class="button danger" data-action="delete-session" data-id="${escapeHtml(s.session_id)}" type="button">Изтрий</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
    els.sessionsTable.querySelectorAll("[data-action]").forEach((btn) => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "open-session") {
        btn.addEventListener("click", () => openSession(id));
      } else if (action === "export") {
        btn.addEventListener("click", () => exportSession(id));
      } else if (action === "delete-session") {
        btn.addEventListener("click", () => deleteSession(id));
      }
    });
  }

  async function deleteSession(id) {
    if (!window.confirm("Изтриване на сесията заедно с всички отговори?")) return;
    try {
      await adminApi(`/quiz/admin/session/${encodeURIComponent(id)}`, adminKey, { method: "DELETE" });
      if (activeSessionId === id) {
        activeSessionId = null;
        saveActiveSession(null);
        stopLivePoll();
        els.livePanel.hidden = true;
      }
      toast("Сесията е изтрита.", "ok");
      refreshSessions();
    } catch (err) {
      toast(err.message || "Изтриването не успя.", "error");
    }
  }

  async function exportSession(id) {
    try {
      const response = await request(
        `/quiz/admin/session/export?session_id=${encodeURIComponent(id)}`,
        { adminKey, raw: true }
      );
      const blob = await response.blob();
      const cd = response.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `quiz_${id}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message || "Експортът не успя.", "error");
    }
  }

  // ---- Create session ------------------------------------------------------

  async function onCreateSession(event) {
    event.preventDefault();
    const tags = selectedTags();
    const tagLabel = tags.join(" + ");
    const payload = {
      bank_id: els.cfBank.value,
      lecture_tag: tags[0] || "",
      lecture_tags: tags,
      display_name: els.cfDisplayName.value.trim() || tagLabel,
      item_count: Number(els.cfItemCount.value),
      duration_minutes: Number(els.cfDuration.value),
      swap_policy: els.cfSwap.value,
      permutation: els.cfPermutation.value,
      feedback: els.cfFeedback.value,
      exhaustion_policy: els.cfExhaustion.value,
      security_mode: els.cfSecurity.value,
    };
    if (!payload.bank_id || tags.length === 0) {
      toast("Изберете банка и поне една тема.", "error");
      return;
    }
    try {
      const result = await adminApi("/quiz/admin/session/create", adminKey, {
        method: "POST",
        body: payload,
      });
      activeSessionId = result.session_id;
      saveActiveSession(activeSessionId);
      toast(`Сесия ${result.join_code} е създадена.`, "ok");
      els.createForm.reset();
      els.cfItemCount.value = 30;
      els.cfDuration.value = 60;
      onBankChange();
      await refreshSessions();
      startLivePoll();
    } catch (err) {
      toast(err.message || "Създаването не успя.", "error");
    }
  }

  // ---- Live panel ---------------------------------------------------------

  function openSession(id) {
    activeSessionId = id;
    saveActiveSession(id);
    refreshSessions();
    startLivePoll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startLivePoll() {
    stopLivePoll();
    if (!activeSessionId) {
      els.livePanel.hidden = true;
      return;
    }
    els.livePanel.hidden = false;
    // Eagerly clear stale UI from any previous active session, so the
    // instructor never sees yesterday's QR or join code while the first
    // poll is in flight.
    qrLoadedFor = null;
    els.liveCode.textContent = "——————";
    els.liveQr.removeAttribute("src");
    els.liveTitle.textContent = "Зареждане…";
    els.liveMeta.textContent = "";
    els.liveStudents.innerHTML = "";
    els.liveEmpty.hidden = true;
    pollLive();
    livePollTimer = setInterval(pollLive, 3000);
  }

  function stopLivePoll() {
    if (livePollTimer) { clearInterval(livePollTimer); livePollTimer = null; }
  }

  async function pollLive() {
    if (!activeSessionId) return;
    try {
      const data = await adminApi(
        `/quiz/admin/session/live?session_id=${encodeURIComponent(activeSessionId)}`,
        adminKey
      );
      renderLive(data);
    } catch (err) {
      // Could be a stale id (deleted); detach quietly.
      if (String(err.message).toLowerCase().includes("not found")) {
        activeSessionId = null;
        saveActiveSession(null);
        els.livePanel.hidden = true;
        stopLivePoll();
        refreshSessions();
        return;
      }
      // Otherwise transient — keep polling.
    }
  }

  function renderLive(data) {
    const s = data.session;
    els.liveTitle.textContent = `Сесия "${s.display_name}"`;
    els.liveMeta.textContent =
      `${sessionTagLabel(s)} · ${s.item_count} въпроса · ${s.duration_minutes} мин · `
      + `swap=${s.swap_policy} · feedback=${s.feedback} · security=${s.security_mode || "standard"}`;
    els.liveCode.textContent = s.join_code;

    // QR (admin endpoint requires admin key, so we set src after a fresh fetch).
    refreshQrSrc(activeSessionId);

    els.liveStart.disabled = s.status !== "lobby";
    els.liveClose.disabled = s.status === "closed";
    els.liveStart.textContent = s.status === "live" ? "Активна" : "Старт";

    const studentCount = data.students.length;
    const ended = data.students.filter((x) => x.ended).length;
    els.statStudents.textContent = `${studentCount}${ended ? ` (${ended} приключили)` : ""}`;
    els.statElapsed.textContent = s.started_at ? fmtTimer(data.elapsed_ms) : "—";
    els.statRemaining.textContent = s.started_at ? fmtTimer(data.remaining_ms) : `${s.duration_minutes}:00`;

    const statusLine = ({
      lobby: "В очакване — натиснете Старт, за да започнат всички.",
      live: "Тестът тече.",
      closed: "Сесията е затворена.",
    })[s.status] || s.status;
    els.liveStatusLine.textContent = statusLine;

    els.liveEmpty.hidden = studentCount > 0;
    els.liveStudents.innerHTML = data.students.map((st) => {
      const statusCell = st.ended
        ? `<span class="badge muted">${escapeHtml(st.end_reason || "ended")}</span>`
        : `<span class="badge ok">тече</span>`;
      return `
        <tr>
          <td>${escapeHtml(st.student_number)}</td>
          <td>${st.answered}</td>
          <td>${st.current_ord || "—"}</td>
          <td>${st.swapped}</td>
          <td>${st.incidents || 0}</td>
          <td>${statusCell}</td>
        </tr>`;
    }).join("");
  }

  async function refreshQrSrc(sessionId) {
    if (qrLoadedFor === sessionId) return;
    qrLoadedFor = sessionId;
    try {
      const response = await request(
        `/quiz/admin/session/qr?session_id=${encodeURIComponent(sessionId)}`,
        { adminKey, raw: true }
      );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      els.liveQr.src = url;
    } catch (_) {
      qrLoadedFor = null;
    }
  }

  async function onStartSession() {
    if (!activeSessionId) return;
    try {
      await adminApi("/quiz/admin/session/start", adminKey, {
        method: "POST",
        body: { session_id: activeSessionId },
      });
      toast("Тестът е стартиран.", "ok");
      pollLive();
      refreshSessions();
    } catch (err) {
      toast(err.message || "Стартирането не успя.", "error");
    }
  }

  async function onCloseSession() {
    if (!activeSessionId) return;
    if (!window.confirm("Да затворим ли сесията? Студентите няма да могат да отговарят повече.")) return;
    try {
      await adminApi("/quiz/admin/session/close", adminKey, {
        method: "POST",
        body: { session_id: activeSessionId },
      });
      toast("Сесията е затворена.", "ok");
      pollLive();
      refreshSessions();
    } catch (err) {
      toast(err.message || "Затварянето не успя.", "error");
    }
  }

  init();
})();
