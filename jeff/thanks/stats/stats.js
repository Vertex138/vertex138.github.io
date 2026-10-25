(() => {
  "use strict";
  const root = document.documentElement;
  const rows = [
    ["arrived", "Jeff first noticed you"],
    ["gallery", "You unlocked Jeff's photo album"],
    ["mood", "You checked Jeff's emotional forecast"],
    ["faq", "You began questioning Jeff's staff"],
    ["kitchen", "You entered Jeff's biscuit business"],
    ["fortune", "Jeff revealed your first fortune"],
    ["mailbox", "You opened Jeff's correspondence"],
    ["ending", "You made it to the final meow"],
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
      return `${two(d.getMonth() + 1)} ${two(d.getDate())}, ${d.getFullYear()} at ${two(d.getHours())}:${two(d.getMinutes())}`;
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
      list.replaceChildren();
      for (const [id, phrase] of rows) {
        const row = document.createElement("li");
        row.className = "stat-row";
        row.dataset.milestone = id;
        const label = document.createElement("span");
        label.className = "stat-phrase";
        label.textContent = phrase;
        const date = document.createElement("time");
        date.className = "stat-date";
        const timestamp = stats?.dates[id];
        if (timestamp) {
          date.dateTime = new Date(timestamp).toISOString();
          date.textContent = formatDate(timestamp);
        } else date.textContent = stats?.legacy ? "Not recorded" : "Not recorded yet";
        row.append(label, date);
        list.append(row);
      }
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