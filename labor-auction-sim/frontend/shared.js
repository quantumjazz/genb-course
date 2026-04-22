(function () {
  // API_BASE can be overridden by the page before this script runs
  // (e.g. <script>window.LABOR_API_BASE = "..."</script>). Otherwise we
  // default to the production host mirrored from the matching-dashboard
  // sibling project — except when running locally, where we point at the
  // dev backend on port 8788.
  function defaultApiBase() {
    if (typeof window === "undefined") return "";
    if (window.LABOR_API_BASE) return window.LABOR_API_BASE;
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "") {
      return `http://${host || "localhost"}:8788`;
    }
    return "https://labor.visiometrica.com";
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

  function makeLogger(element) {
    return function log(message) {
      if (!element) return;
      const timestamp = new Date().toLocaleTimeString();
      element.textContent = `[${timestamp}] ${message}\n${element.textContent}`.trim();
    };
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

  async function request(path, { method = "GET", body, adminKey } = {}) {
    const apiBase = API_BASE.replace(/\/$/, "");
    if (window.location.protocol === "https:" && apiBase.startsWith("http://")) {
      throw new Error("This page is HTTPS, so the API base must also be HTTPS.");
    }
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (adminKey) headers["X-Admin-Key"] = adminKey;
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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

  function fmtMoney(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    const rounded = Math.round(value * 100) / 100;
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(rounded);
  }

  function fmtPercent(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return `${Math.round(value * 1000) / 10}%`;
  }

  function phaseLabel(phase) {
    const labels = {
      lobby: "Waiting to start",
      auction: "Auction — pick a job",
      effort: "Effort — work hard or slack off?",
      resolution: "Results",
      ended: "Session complete",
    };
    return labels[phase] || "Unknown phase";
  }

  function buildTimer(phaseEndsMs, phaseDurationMs) {
    const now = Date.now();
    const remaining = Math.max(0, phaseEndsMs - now);
    const pct = Math.max(0, Math.min(100, (remaining / phaseDurationMs) * 100));
    return { remaining, pct };
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return function (...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(this, args);
        }, remaining);
      }
    };
  }

  /**
   * Connects to the SSE endpoint for a session and calls the handler whenever
   * an event arrives. Falls back to polling every 2s if SSE fails. Returns an
   * object with a close() method.
   */
  function connectStream(sessionCode, onEvent, onError) {
    let closed = false;
    let es = null;
    let pollTimer = null;

    function startPolling() {
      if (pollTimer) return;
      let lastTick = 0;
      pollTimer = setInterval(() => {
        lastTick++;
        onEvent({ kind: "tick", poll: true, counter: lastTick });
      }, 2000);
    }

    try {
      const apiBase = API_BASE.replace(/\/$/, "");
      es = new EventSource(`${apiBase}/api/session/${encodeURIComponent(sessionCode)}/events`);
      es.onmessage = (ev) => {
        if (closed) return;
        try {
          const data = JSON.parse(ev.data);
          onEvent(data);
        } catch {
          // ignore
        }
      };
      es.onerror = (ev) => {
        if (closed) return;
        if (onError) onError(ev);
        // Reconnect logic handled by the browser; if the connection is
        // repeatedly failing, drop to polling.
        if (es.readyState === EventSource.CLOSED) {
          startPolling();
        }
      };
    } catch (exc) {
      console.warn("SSE failed, falling back to polling:", exc);
      startPolling();
    }

    return {
      close() {
        closed = true;
        if (es) es.close();
        if (pollTimer) clearInterval(pollTimer);
      },
    };
  }

  /**
   * Local cache of the latest snapshot so timer interpolation works smoothly
   * even between server pushes.
   */
  function createSmoothTimer(getSeconds, render) {
    let raf = null;
    let lastSeconds = 0;
    let lastFetch = performance.now();
    function tick() {
      const elapsed = (performance.now() - lastFetch) / 1000;
      const estimate = Math.max(0, lastSeconds - elapsed);
      render(estimate);
      raf = requestAnimationFrame(tick);
    }
    return {
      update(seconds) {
        lastSeconds = Number(seconds || 0);
        lastFetch = performance.now();
        if (!raf) raf = requestAnimationFrame(tick);
      },
      stop() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      },
    };
  }

  /** Line chart on a Canvas2D context. One x-axis, many series. */
  function drawLineChart(canvas, series, options = {}) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 44, padR = 12, padT = 12, padB = 24;
    const plotW = Math.max(10, w - padL - padR);
    const plotH = Math.max(10, h - padT - padB);
    // Collect ranges
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const s of series) {
      for (const pt of s.data) {
        if (pt.x < xMin) xMin = pt.x;
        if (pt.x > xMax) xMax = pt.x;
        if (pt.y < yMin) yMin = pt.y;
        if (pt.y > yMax) yMax = pt.y;
      }
    }
    if (!isFinite(xMin) || !isFinite(yMin)) {
      ctx.fillStyle = "#687277";
      ctx.font = "13px 'Avenir Next', sans-serif";
      ctx.fillText("No data yet.", padL, padT + 20);
      return;
    }
    if (xMax === xMin) xMax = xMin + 1;
    const yLow = options.yMin !== undefined ? options.yMin : Math.min(0, yMin);
    const yHigh = options.yMax !== undefined ? options.yMax : yMax + (yMax - yLow) * 0.15;
    const yRange = Math.max(1e-9, yHigh - yLow);
    // Axes
    ctx.strokeStyle = "rgba(31,42,46,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();
    // Gridlines + y labels
    ctx.fillStyle = "#687277";
    ctx.font = "11px 'Avenir Next', sans-serif";
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const yVal = yLow + (yRange * i) / ticks;
      const y = padT + plotH - (i / ticks) * plotH;
      ctx.strokeStyle = "rgba(31,42,46,0.06)";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(options.yFormat ? options.yFormat(yVal) : Math.round(yVal).toString(), 6, y + 3);
    }
    // X ticks
    const xTicks = Math.min(8, Math.max(2, Math.round(xMax - xMin)));
    for (let i = 0; i <= xTicks; i++) {
      const xVal = xMin + ((xMax - xMin) * i) / xTicks;
      const x = padL + ((xVal - xMin) / (xMax - xMin)) * plotW;
      ctx.fillText(Math.round(xVal).toString(), x - 4, padT + plotH + 16);
    }
    // Series
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.data.forEach((pt, idx) => {
        const x = padL + ((pt.x - xMin) / (xMax - xMin)) * plotW;
        const y = padT + plotH - ((pt.y - yLow) / yRange) * plotH;
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // Points
      for (const pt of s.data) {
        const x = padL + ((pt.x - xMin) / (xMax - xMin)) * plotW;
        const y = padT + plotH - ((pt.y - yLow) / yRange) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const FIRM_COLORS = {
    small: "#b6592f",
    mid: "#0d6a6e",
    big: "#6b2c6b",
    overall: "#1f2a2e",
  };

  window.LaborShared = {
    escapeHtml,
    makeLogger,
    toast,
    publicApi,
    adminApi,
    fmtMoney,
    fmtPercent,
    phaseLabel,
    buildTimer,
    throttle,
    connectStream,
    createSmoothTimer,
    drawLineChart,
    FIRM_COLORS,
    API_BASE,
  };
}());
