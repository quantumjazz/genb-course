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
  let qrObjectUrl = null;
  let issuedCredentials = [];
  let credentialGeneration = 0;

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
    privacyWarning: document.getElementById("privacy-notice-warning"),
    accessPanel: document.getElementById("access-codes-panel"),
    accessForm: document.getElementById("access-codes-form"),
    accessRoster: document.getElementById("access-codes-roster"),
    accessReplace: document.getElementById("access-codes-replace"),
    accessIssue: document.getElementById("access-codes-issue"),
    accessClear: document.getElementById("access-codes-clear"),
    accessStatus: document.getElementById("access-codes-status"),
    accessResult: document.getElementById("access-codes-result"),
    accessRows: document.getElementById("access-codes-rows"),
    accessDownload: document.getElementById("access-codes-download"),

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
    removeLegacyKey();
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
    els.accessForm.addEventListener("submit", onIssueAccessCodes);
    els.accessClear.addEventListener("click", () => clearIssuedCodes());
    els.accessDownload.addEventListener("click", downloadAccessCodes);
    els.accessReplace.addEventListener("change", () => {
      els.accessIssue.textContent = els.accessReplace.checked ? "Подмени личните кодове" : "Издай лични кодове";
    });
    window.addEventListener("pagehide", clearKey);

    refreshPrivacyNoticeWarning();
    refreshAll();
  }

  function removeLegacyKey() {
    try { window.localStorage.removeItem(KEY_STORAGE); } catch (_) { /* ignore */ }
    try { window.sessionStorage.removeItem(KEY_STORAGE); } catch (_) { /* ignore */ }
  }
  function loadActiveSession() {
    try {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE);
      return window.sessionStorage.getItem(ACTIVE_SESSION_STORAGE) || null;
    }
    catch (_) { return null; }
  }
  function saveActiveSession(id) {
    try {
      if (id) window.sessionStorage.setItem(ACTIVE_SESSION_STORAGE, id);
      else window.sessionStorage.removeItem(ACTIVE_SESSION_STORAGE);
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
    // dialog.close() dispatches its close event asynchronously; wipe the
    // password field immediately on every save, cancel and lock action.
    els.keyInput.value = "";
    if (typeof els.keyDialog.close === "function" && els.keyDialog.open) {
      els.keyDialog.close();
    } else {
      els.keyDialog.removeAttribute("open");
      els.keyInput.value = "";
    }
  }

  function onKeyDialogSubmit(event) {
    event.preventDefault();
    clearIssuedCodes();
    clearLiveView();
    adminKey = els.keyInput.value.trim();
    removeLegacyKey();
    refreshKeyStatus();
    closeKeyDialog();
    refreshAll();
  }

  function clearKey() {
    adminKey = "";
    removeLegacyKey();
    clearIssuedCodes();
    clearLiveView();
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
    if (!adminKey) {
      stopLivePoll();
      banksCache = [];
      renderBanks([]);
      renderBankSelect([]);
      renderSessions([]);
      els.banksEmpty.textContent = "Въведете админ ключ, за да заредите банките.";
      els.sessionsEmpty.textContent = "Въведете админ ключ, за да заредите сесиите.";
      els.livePanel.hidden = true;
      return;
    }
    await refreshBanks();
    await refreshSessions();
    if (activeSessionId) {
      startLivePoll();
    }
  }

  async function refreshPrivacyNoticeWarning() {
    try {
      const config = await request("/quiz/config");
      els.privacyWarning.hidden = Boolean(config.privacy_notice_url);
      els.privacyWarning.textContent = "Не е зададен адрес на пълното университетско уведомление за лични данни. Настройте QUIZ_PRIVACY_NOTICE_URL преди тест с реални студенти.";
    } catch (_) {
      els.privacyWarning.hidden = false;
      els.privacyWarning.textContent = "Адресът на уведомлението за лични данни не може да бъде проверен. Проверете настройката на сървъра преди тест с реални студенти.";
    }
  }

  function clearLiveView() {
    qrLoadedFor = null;
    if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
    qrObjectUrl = null;
    els.liveCode.textContent = "——————";
    els.liveQr.removeAttribute("src");
    els.liveTitle.textContent = "Зареждане…";
    els.liveMeta.textContent = "";
    els.liveStatusLine.textContent = "";
    els.liveStudents.innerHTML = "";
    els.liveEmpty.hidden = true;
    els.statStudents.textContent = "0";
    els.statElapsed.textContent = "—";
    els.statRemaining.textContent = "—";
  }

  // Codes and roster input stay in this page's memory and DOM only.
  function clearIssuedCodes(clearRoster = true) {
    credentialGeneration += 1;
    issuedCredentials = [];
    els.accessRows.replaceChildren();
    els.accessResult.hidden = true;
    els.accessStatus.textContent = "";
    els.accessIssue.disabled = false;
    if (clearRoster) {
      els.accessRoster.value = "";
      els.accessReplace.checked = false;
      els.accessIssue.textContent = "Издай лични кодове";
      els.accessPanel.open = false;
    }
  }

  async function onIssueAccessCodes(event) {
    event.preventDefault();
    const sessionId = activeSessionId;
    const key = adminKey;
    if (!sessionId || !key) return;
    const studentNumbers = [...new Set(els.accessRoster.value.split(/\r?\n/)
      .map((value) => value.trim().toUpperCase()).filter(Boolean))];
    if (!studentNumbers.length) {
      toast("Въведете поне един факултетен номер.", "error");
      return;
    }
    const replace = els.accessReplace.checked;
    if (replace && !window.confirm("Подмяна на личните кодове за въведения списък? Старите кодове и текущият вход стават невалидни. Отговорите се запазват. Раздайте новите кодове индивидуално.")) return;
    clearIssuedCodes(false);
    const generation = credentialGeneration;
    els.accessIssue.disabled = true;
    els.accessStatus.textContent = "Издаване на кодове…";
    try {
      const result = await adminApi("/quiz/admin/session/access-codes", key, {
        method: "POST",
        body: { session_id: sessionId, student_numbers: studentNumbers, replace },
      });
      if (sessionId !== activeSessionId || key !== adminKey || generation !== credentialGeneration) return;
      issuedCredentials = (result.credentials || []).map((entry) => ({
        student_number: String(entry.student_number), access_code: String(entry.access_code),
      }));
      const skipped = result.skipped || [];
      els.accessStatus.textContent = `Издадени: ${issuedCredentials.length}. Пропуснати със съществуващ код: ${skipped.length}.`
        + (skipped.length ? ` Номера: ${skipped.join(", ")}. За нов код въведете само тях и изберете изрична подмяна.` : "");
      els.accessRows.innerHTML = issuedCredentials.map((entry) => `<tr>
        <td>${escapeHtml(entry.student_number)}</td><td><code>${escapeHtml(entry.access_code)}</code></td>
      </tr>`).join("");
      els.accessResult.hidden = issuedCredentials.length === 0;
      els.accessReplace.checked = false;
      els.accessIssue.textContent = "Издай лични кодове";
      pollLive();
    } catch (err) {
      if (sessionId !== activeSessionId || key !== adminKey || generation !== credentialGeneration) return;
      els.accessStatus.textContent = `Не са получени кодове: ${err.message}. При прекъсната връзка може вече да са издадени; ако липсват, направете изрична подмяна.`;
      toast(err.message || "Издаването не успя.", "error");
    } finally {
      if (generation === credentialGeneration) els.accessIssue.disabled = false;
    }
  }

  function accessCsvCell(value) {
    let text = String(value ?? "");
    // Quoting alone does not stop spreadsheet formula evaluation.
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadAccessCodes() {
    if (!adminKey || !activeSessionId || !issuedCredentials.length) return;
    const rows = [["student_number", "access_code"], ...issuedCredentials.map((entry) => [entry.student_number, entry.access_code])];
    const csv = "\uFEFF" + rows.map((row) => row.map(accessCsvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `quiz_private_access_codes_${activeSessionId}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Banks --------------------------------------------------------------

  async function refreshBanks() {
    const key = adminKey;
    if (!key) return;
    try {
      const data = await adminApi("/quiz/admin/bank/list", key);
      if (key !== adminKey) return;
      banksCache = data.banks || [];
      renderBanks(banksCache);
      renderBankSelect(banksCache);
    } catch (err) {
      if (key !== adminKey) return;
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
    const key = adminKey;
    if (!key) return;
    try {
      const data = await adminApi("/quiz/admin/session/list", key);
      if (key !== adminKey) return;
      renderSessions(data.sessions || []);
    } catch (err) {
      if (key !== adminKey) return;
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
        clearIssuedCodes();
        clearLiveView();
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
    const key = adminKey;
    if (!key) return;
    try {
      const response = await request(
        `/quiz/admin/session/export?session_id=${encodeURIComponent(id)}`,
        { adminKey: key, raw: true }
      );
      const blob = await response.blob();
      if (key !== adminKey) return;
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
    const key = adminKey;
    if (!key) return;
    try {
      const result = await adminApi("/quiz/admin/session/create", key, {
        method: "POST",
        body: payload,
      });
      if (key !== adminKey) return;
      clearIssuedCodes();
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
    if (activeSessionId !== id) clearIssuedCodes();
    activeSessionId = id;
    saveActiveSession(id);
    refreshSessions();
    startLivePoll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startLivePoll() {
    stopLivePoll();
    if (!activeSessionId || !adminKey) {
      els.livePanel.hidden = true;
      return;
    }
    els.livePanel.hidden = false;
    // Eagerly clear stale UI from any previous active session, so the
    // instructor never sees yesterday's QR or join code while the first
    // poll is in flight.
    clearLiveView();
    pollLive();
    livePollTimer = setInterval(pollLive, 3000);
  }

  function stopLivePoll() {
    if (livePollTimer) { clearInterval(livePollTimer); livePollTimer = null; }
  }

  async function pollLive() {
    const sessionId = activeSessionId;
    const key = adminKey;
    if (!sessionId || !key) return;
    try {
      const data = await adminApi(
        `/quiz/admin/session/live?session_id=${encodeURIComponent(sessionId)}`,
        key
      );
      if (sessionId !== activeSessionId || key !== adminKey) return;
      renderLive(data);
    } catch (err) {
      if (sessionId !== activeSessionId || key !== adminKey) return;
      // Could be a stale id (deleted); detach quietly.
      if (String(err.message).toLowerCase().includes("not found")) {
        clearIssuedCodes();
        clearLiveView();
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
    const key = adminKey;
    qrLoadedFor = sessionId;
    try {
      const response = await request(
        `/quiz/admin/session/qr?session_id=${encodeURIComponent(sessionId)}`,
        { adminKey: key, raw: true }
      );
      const blob = await response.blob();
      if (sessionId !== activeSessionId || key !== adminKey) return;
      if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
      qrObjectUrl = URL.createObjectURL(blob);
      els.liveQr.src = qrObjectUrl;
    } catch (_) {
      if (sessionId === activeSessionId && key === adminKey) qrLoadedFor = null;
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
