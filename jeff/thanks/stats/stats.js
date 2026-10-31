(() => {
  "use strict";
  const root = document.documentElement;
  const rows = [
    ["arrived", "You first met Jeff"],
    ["gallery", "Jeff's began sharing his photo album"],
    ["mood", "Jeff began sharing his feelingswith you"],
    ["faq", "Jeff and his staff agreed to questions"],
    ["kitchen", "Jeff invited you to his biscuit venture"],
    ["fortune", "Jeff offered to tell your fortune"],
    ["mailbox", "Jeff opened his mailbox to you"],
    ["ending", "Jeff presented his final show"]
  ];

  function hasAccess() {
    try {
      const ids = JSON.parse(localStorage.getItem("viewedImages") || "[]");
      return Array.isArray(ids) && new Set(ids.map(Number).filter(id =>
        Number.isInteger(id) && id >= 1 && id <= 150)).size === 150;
    } catch { return false; }
  }

  if (!hasAccess()) { window.location.replace("/jeff/"); return; }

  function initialize() {
    const list = document.getElementById("stats-list");
    const heading = document.querySelector("#stats-header h1");
    const note = document.getElementById("stats-history-note");
    const puzzleStatus = document.getElementById("stats-puzzle-status");

    function formatDate(timestamp) {
      const d = new Date(timestamp);
      const two = value => String(value).padStart(2, "0");
      const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()];
      const hour = d.getHours();
      return `${month} ${two(d.getDate())}, ${d.getFullYear()} at ${hour % 12 || 12}:${two(d.getMinutes())} ${hour < 12 ? "AM" : "PM"}`;
    }

    function formatDuration(milliseconds) {
      let seconds = Math.floor(milliseconds / 1000);
      const parts = [];
      for (const [name, size] of [["day", 86400], ["hour", 3600], ["minute", 60]]) {
        const count = Math.floor(seconds / size);
        seconds %= size;
        if (count) parts.push(`${count.toLocaleString("en-US")} ${name}${count === 1 ? "" : "s"}`);
      }
      return parts.join(", ") || `${seconds} second${seconds === 1 ? "" : "s"}`;
    }

    function appendRow(id, phrase, value, timestamp) {
      const row = document.createElement("li");
      row.className = "stat-row";
      row.dataset.milestone = id;
      const label = document.createElement("span");
      label.className = "stat-phrase";
      label.textContent = phrase;
      const detail = document.createElement(timestamp ? "time" : "span");
      detail.className = "stat-date";
      detail.textContent = value;
      if (timestamp) detail.dateTime = new Date(timestamp).toISOString();
      row.append(label, detail);
      list.append(row);
    }

    function fitText() {
      root.classList.toggle("stats-portrait", window.innerWidth < window.innerHeight);
      root.style.removeProperty("--stats-line-size");
      root.style.removeProperty("--stats-title-size");
      const base = parseFloat(getComputedStyle(list).fontSize);
      let scale = 1;
      for (const row of list.children) {
        const [phrase, date] = row.children;
        const a = phrase.getBoundingClientRect().width;
        const b = date.getBoundingClientRect().width;
        const needed = root.classList.contains("stats-portrait")
          ? Math.max(a, b) : a + b + parseFloat(getComputedStyle(row).columnGap);
        scale = Math.min(scale, row.clientWidth / Math.max(needed, 1));
      }
      if (scale < 1) root.style.setProperty("--stats-line-size", `${Math.max(1, base * scale * 0.99)}px`);
      if (heading.scrollWidth > heading.clientWidth) {
        const size = parseFloat(getComputedStyle(heading).fontSize);
        root.style.setProperty("--stats-title-size", `${size * heading.clientWidth / heading.scrollWidth * 0.99}px`);
      }
    }

    function render() {
      const stats = window.JeffSite?.stats?.read();
      const missingDate = stats?.legacy ? "Not recorded" : "Not recorded yet";
      list.replaceChildren();
      for (const [id, phrase] of rows) {
        const timestamp = stats?.dates[id];
        appendRow(id, phrase, timestamp ? formatDate(timestamp) : missingDate, timestamp);
      }
      const start = stats?.dates.arrived;
      const end = stats?.dates.ending;
      appendRow("journey", "Your journey with Jeff lasted", start && end && end >= start
        ? formatDuration(end - start) : missingDate);
      note.hidden = !stats?.legacy;
      puzzleStatus.textContent = stats?.dates.puzzleFinished
        ? "...and you even finished the hidden puzzle!"
        : stats?.dates.puzzleFound
          ? "...you have uncovered the hidden puzzle, but haven't reached its ending."
          : "...but you haven't uncovered the hidden puzzle yet.";
      fitText();
    }

    render();
    root.classList.remove("stats-pending");
    window.addEventListener("resize", fitText);
    window.visualViewport?.addEventListener("resize", fitText);
    document.fonts?.ready.then(fitText);
    new MutationObserver(fitText).observe(root, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("jeff:stats-changed", render);
    document.addEventListener("jeff:history-cleared", () => window.location.replace("/jeff/"));
    window.addEventListener("storage", event => {
      if ((event.key === "viewedImages" || event.key === null) && !hasAccess()) {
        window.location.replace("/jeff/");
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();