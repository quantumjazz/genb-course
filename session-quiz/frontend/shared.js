(function () {
  // QUIZ_API_BASE can be overridden by the page before this script runs.
  function defaultApiBase() {
    if (typeof window === "undefined") return "";
    if (window.QUIZ_API_BASE) return window.QUIZ_API_BASE;
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "") {
      return `http://${host || "localhost"}:8789`;
    }
    return `${window.location.protocol}//${window.location.host}`;
  }
  const API_BASE = defaultApiBase();

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function toast(message, tone = "ok", lifetimeMs = 3200) {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      document.body.appendChild(region);
    }
    const div = document.createElement("div");
    div.className = `toast ${tone === "error" ? "error" : tone === "ok" ? "ok" : ""}`;
    div.textContent = message;
    region.appendChild(div);
    setTimeout(() => div.remove(), lifetimeMs);
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function canUseRawHeaderValue(value) {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 32 || code === 127 || code > 255) return false;
    }
    return true;
  }

  async function request(path, { method = "GET", body, adminKey, formData, raw } = {}) {
    const apiBase = API_BASE.replace(/\/$/, "");
    if (window.location.protocol === "https:" && apiBase.startsWith("http://")) {
      throw new Error("This page is HTTPS, so the API base must also be HTTPS.");
    }
    const headers = {};
    if (body !== undefined && !formData) headers["Content-Type"] = "application/json";
    if (adminKey) {
      headers["X-Admin-Key-B64"] = encodeBase64Utf8(adminKey);
      if (canUseRawHeaderValue(adminKey)) headers["X-Admin-Key"] = adminKey;
    }
    let payloadBody;
    if (formData) {
      payloadBody = formData;
    } else if (body !== undefined) {
      payloadBody = JSON.stringify(body);
    }
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: payloadBody,
    });
    if (raw) {
      if (!response.ok) {
        let msg = `Request failed (${response.status}).`;
        try {
          const errPayload = await response.json();
          if (errPayload && errPayload.error) msg = errPayload.error;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
      }
      return response;
    }
    const contentType = response.headers.get("Content-Type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();
    if (!response.ok) {
      const msg = (payload && payload.error) || `Request failed with status ${response.status}`;
      throw new Error(msg);
    }
    return payload;
  }

  function publicApi(path, opts) {
    return request(path, opts);
  }

  function adminApi(path, adminKey, opts = {}) {
    return request(path, { ...opts, adminKey: (adminKey || "").trim() });
  }

  function fmtTimer(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function fmtDate(epochMs) {
    if (!epochMs) return "—";
    return new Date(epochMs).toLocaleString();
  }

  window.QuizShared = {
    API_BASE,
    escapeHtml,
    toast,
    publicApi,
    adminApi,
    request,
    fmtTimer,
    fmtDate,
  };
})();
