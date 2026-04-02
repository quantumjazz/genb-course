(function () {
  const API_BASE = "https://matching.visiometrica.com";

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function createLogger(element) {
    return function log(message) {
      const timestamp = new Date().toLocaleTimeString();
      element.textContent = `[${timestamp}] ${message}\n${element.textContent}`.trim();
    };
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function formatDate(value, fallback = "Not submitted") {
    return value ? new Date(value).toLocaleString() : fallback;
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

  function badgeClass(tone) {
    return tone ? `badge ${tone}` : "badge";
  }

  function setBadge(element, text, tone = "muted") {
    element.textContent = text;
    element.className = badgeClass(tone);
  }

  async function request(path, options = {}, includeAdmin = false, adminKey = "") {
    const apiBase = API_BASE.replace(/\/$/, "");
    if (window.location.protocol === "https:" && apiBase.startsWith("http://")) {
      throw new Error("This page is on HTTPS, so the API base URL must also use HTTPS.");
    }
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (includeAdmin && adminKey.trim()) {
      headers.set("X-Admin-Key", adminKey.trim());
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

  function adminApi(path, adminKey, options = {}) {
    return request(path, options, true, adminKey || "");
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
    const cleaned = String(query || "").trim().toLowerCase();
    if (!cleaned) {
      return rows;
    }
    return rows.filter((row) =>
      selectors.some((selector) => String(selector(row) ?? "").toLowerCase().includes(cleaned)),
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

  window.MatchingShared = {
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
  };
}());
