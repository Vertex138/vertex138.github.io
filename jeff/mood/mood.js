(() => {
  "use strict";

  const MOOD_UNLOCK_REQUIREMENT = 15;
  const TOTAL_IMAGE_GOAL = 150;
  const RECENT_IMAGE_LIMIT = 10;
  const ROOT_PAGE = "/jeff/";
  const MOOD_TIME_ZONE = "America/New_York";
  const MOOD_INTERVAL = 3
  const MOOD_HOURS = Array.from(
  { length: 24 / MOOD_INTERVAL },
  (_, index) => index * MOOD_INTERVAL
);
  const MOOD_COUNT = 20;
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const EASTERN_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: MOOD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const EASTERN_ZONE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: MOOD_TIME_ZONE,
    timeZoneName: "short",
  });
  const SOURCES = {
    captions: "/jeff/mood/mood.json",
    moodImages: "/jeff/mood/mood_img.json",
    images: "/jeff/images.json",
  };
  const STORAGE_KEYS = {
    recent: "recentImages",
    viewed: "viewedImages",
    streak: "noNewImageStreak",
    completion: "collectionCompleteAcknowledged",
  };

  let countAnimationTimeout = null;
  let moodRefreshTimeout = null;
  let activeMoodSeed = null;
  let loading = false;

  function isValidImageId(value) {
    return Number.isInteger(value) && value >= 1 && value <= TOTAL_IMAGE_GOAL;
  }

  function getStoredImageIds(key) {
    try {
      const values = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(values) ? values.map(Number).filter(isValidImageId) : [];
    } catch (error) {
      console.warn(`Could not retrieve "${key}" from localStorage:`, error);
      return [];
    }
  }

  function getViewedImageIds() {
    return [...new Set(getStoredImageIds(STORAGE_KEYS.viewed))];
  }

  function saveImageIds(key, ids) {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch (error) {
      console.warn(`Could not save "${key}" to localStorage:`, error);
    }
  }

  function redirectIfMoodIsLocked() {
    if (getViewedImageIds().length >= MOOD_UNLOCK_REQUIREMENT) {
      return false;
    }
    window.location.replace(ROOT_PAGE);
    return true;
  }

  if (redirectIfMoodIsLocked()) {
    return;
  }
  document.documentElement.style.display = "";

  function reducedMotionEnabled() {
    if (window.JeffSite?.reducedMotionEnabled) {
      return window.JeffSite.reducedMotionEnabled();
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  async function fetchJson(source) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Could not load ${source}: ${response.status}`);
    }
    return response.json();
  }

  async function fetchCaptionsAndTime() {
    const url = new URL(SOURCES.captions, window.location.href);
    const cacheKey = window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    url.searchParams.set("_clock", cacheKey);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${SOURCES.captions}: ${response.status}`);
    }

    const dateHeader = response.headers.get("Date");
    const serverTime = dateHeader ? new Date(dateHeader) : new Date(Number.NaN);

    if (Number.isNaN(serverTime.getTime())) {
      console.warn("A shared server time was unavailable; using this device's clock.");
    }

    return {
      captions: await response.json(),
      now: Number.isNaN(serverTime.getTime()) ? new Date() : serverTime,
    };
  }

  function getEasternParts(date) {
    const parts = EASTERN_PARTS_FORMATTER.formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
    };
  }

  function makeMoodSeed({ year, month, day, hour }) {
    return [year, month, day, hour]
      .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
      .join("");
  }

  function hashSeed(seed) {
    let hash = 2166136261;
    for (const character of seed) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function shiftCalendarDate({ year, month, day }, amount) {
    const shifted = new Date(Date.UTC(year, month - 1, day + amount));
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }

  function getDayMoodIndexes(dateParts) {
    const used = new Set();

    return MOOD_HOURS.map((hour) => {
      const seed = makeMoodSeed({ ...dateParts, hour });
      let index = hashSeed(seed) % MOOD_COUNT;

      while (used.has(index)) {
        index = (index + 1) % MOOD_COUNT;
      }

      used.add(index);
      return index;
    });
  }

  function getMoodPeriod(now) {
    const current = getEasternParts(now);
    const dateParts = { year: current.year, month: current.month, day: current.day };
    const periodHour = Math.floor(current.hour / MOOD_INTERVAL) * MOOD_INTERVAL;
    const period = { ...dateParts, hour: periodHour };
    const moodIndexes = getDayMoodIndexes(dateParts);
    const previousDate = shiftCalendarDate(dateParts, -1);
    const previousDayIndexes = getDayMoodIndexes(previousDate);

    // Swapping the first two values prevents a repeat across midnight while
    // preserving six unique moods within every day.
    if (moodIndexes[0] === previousDayIndexes[previousDayIndexes.length - 1]) {
      [moodIndexes[0], moodIndexes[1]] = [moodIndexes[1], moodIndexes[0]];
    }

    return {
      ...period,
      seed: makeMoodSeed(period),
      mood: (moodIndexes[periodHour / MOOD_INTERVAL] + 1) * 5,
    };
  }

  function getTimeZoneName(now) {
    const part = EASTERN_ZONE_FORMATTER
      .formatToParts(now)
      .find(({ type }) => type === "timeZoneName");
    return part?.value || "ET";
  }

  function formatMoodTimestamp(period, now) {
    const displayHour = period.hour % 12 || 12;
    const meridiem = period.hour < 12 ? "AM" : "PM";
    return `Mood as of ${MONTH_NAMES[period.month - 1]} ${period.day}, ${period.year}, `
      + `at ${displayHour} ${meridiem} ${getTimeZoneName(now)}`;
  }

  function millisecondsUntilNextMood(now) {
    let candidate = Math.floor(now.getTime() / 60000) * 60000 + 60000;

    for (let minute = 0; minute < 360; minute += 1, candidate += 60000) {
      const parts = getEasternParts(new Date(candidate));
      if (parts.minute === 0 && parts.hour % MOOD_INTERVAL === 0) {
        return candidate - now.getTime();
      }
    }

    return MOOD_INTERVAL * 60 * 60 * 1000;
  }

  function scheduleMoodRefresh(now) {
    clearTimeout(moodRefreshTimeout);
    moodRefreshTimeout = setTimeout(initializeMood, millisecondsUntilNextMood(now) + 1500);
  }

  function getMappedValue(map, mood, name) {
    if (!isPlainObject(map)) {
      throw new Error(`${name} must contain a JSON object.`);
    }
    const value = map[String(mood)];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${name} does not contain a valid entry for ${mood}.`);
    }
    return value.trim();
  }

  function hsvToRgb(hue, saturation, value) {
    const chroma = value * saturation;
    const section = hue / 60;
    const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
    const minimum = value - chroma;
    let red = 0;
    let green = 0;
    let blue = 0;

    if (section < 1) {
      red = chroma;
      green = intermediate;
    } else if (section < 2) {
      red = intermediate;
      green = chroma;
    } else if (section < 3) {
      green = chroma;
      blue = intermediate;
    } else if (section < 4) {
      green = intermediate;
      blue = chroma;
    } else if (section < 5) {
      red = intermediate;
      blue = chroma;
    } else {
      red = chroma;
      blue = intermediate;
    }

    return `rgb(${Math.round((red + minimum) * 255)}, ${Math.round(
      (green + minimum) * 255,
    )}, ${Math.round((blue + minimum) * 255)})`;
  }

  function displayMeter(mood, period, now) {
    const meter = document.getElementById("mood-meter");
    const outline = document.getElementById("mood-meter-outline");
    const fill = document.getElementById("mood-meter-fill");
    const value = document.getElementById("mood-value");
    const timestamp = document.getElementById("mood-timestamp");
    const color = hsvToRgb(mood, 0.7, 0.9);

    document.documentElement.style.setProperty("--mood-color", color);
    value.textContent = `${mood}%`;
    meter.dataset.seed = period.seed;
    meter.setAttribute("aria-label", `Jeff's current mood is ${mood} percent`);
    timestamp.textContent = formatMoodTimestamp(period, now);
    timestamp.hidden = false;
    meter.classList.add("is-ready");

    const applyFill = () => {
      outline.style.strokeDasharray = `${mood} 100`;
      fill.style.strokeDasharray = `${mood} 100`;
    };
    if (reducedMotionEnabled()) {
      applyFill();
    } else {
      requestAnimationFrame(() => requestAnimationFrame(applyFill));
    }
  }

  function preloadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load image: ${source}`));
      image.src = source;
    });
  }

  function rememberRecentImage(imageId) {
    const recentIds = getStoredImageIds(STORAGE_KEYS.recent).filter((id) => id !== imageId);
    recentIds.push(imageId);
    saveImageIds(STORAGE_KEYS.recent, recentIds.slice(-RECENT_IMAGE_LIMIT));
  }

  function saveStreak(value) {
    try {
      localStorage.setItem(STORAGE_KEYS.streak, String(value));
    } catch (error) {
      console.warn("Could not save the no-NEW image streak:", error);
    }
  }

  function getStreak() {
    try {
      const value = Number(localStorage.getItem(STORAGE_KEYS.streak));
      return Number.isInteger(value) && value >= 0 ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function showNewIndicator(viewedCount) {
    const indicator = document.getElementById("new-indicator");
    const count = document.getElementById("viewed-count");
    clearTimeout(countAnimationTimeout);
    count.textContent = String(Math.max(viewedCount - 1, 0));
    count.classList.remove("increment");
    indicator.classList.remove("show");
    void indicator.offsetWidth;
    indicator.setAttribute("aria-hidden", "false");
    indicator.classList.add("show");
    countAnimationTimeout = setTimeout(() => {
      count.textContent = String(viewedCount);
      count.classList.add("increment");
    }, 220);
  }

  function saveCompletionAcknowledged(acknowledged) {
    try {
      if (acknowledged) {
        localStorage.setItem(STORAGE_KEYS.completion, "true");
      } else {
        localStorage.removeItem(STORAGE_KEYS.completion);
      }
    } catch (error) {
      console.warn("Could not save the collection-complete state:", error);
    }
  }

  function updateCompletionState(viewedCount) {
    const complete = viewedCount >= TOTAL_IMAGE_GOAL;
    const star = document.getElementById("collection-complete-star");
    const overlay = document.getElementById("collection-complete-overlay");
    star.hidden = !complete;

    if (!complete) {
      overlay.hidden = true;
      saveCompletionAcknowledged(false);
      return;
    }

    let acknowledged = false;
    try {
      acknowledged = localStorage.getItem(STORAGE_KEYS.completion) === "true";
    } catch (error) {
      acknowledged = false;
    }
    if (!acknowledged) {
      overlay.hidden = false;
      requestAnimationFrame(() => document.getElementById("collection-continue-button").focus());
    }
  }

  function recordDisplayedImage(imageId) {
    rememberRecentImage(imageId);
    const viewedIds = getViewedImageIds();
    const isNew = !viewedIds.includes(imageId);

    if (isNew) {
      viewedIds.push(imageId);
      saveImageIds(STORAGE_KEYS.viewed, viewedIds);
      saveStreak(0);
      showNewIndicator(viewedIds.length);
    } else {
      saveStreak(getStreak() + 1);
    }

    updateCompletionState(viewedIds.length);
    document.dispatchEvent(new CustomEvent("jeff:progress-changed"));
  }

  function showError() {
    document.getElementById("mood-error-overlay").hidden = false;
    requestAnimationFrame(() => document.getElementById("mood-retry-button").focus());
  }

  function hideError() {
    document.getElementById("mood-error-overlay").hidden = true;
  }

  async function initializeMood() {
    if (loading) {
      return;
    }
    loading = true;
    hideError();
    document.getElementById("mood-page").setAttribute("aria-busy", "true");

    try {
      const [{ captions, now }, moodImages, images] = await Promise.all([
        fetchCaptionsAndTime(),
        fetchJson(SOURCES.moodImages),
        fetchJson(SOURCES.images),
      ]);
      const period = getMoodPeriod(now);
      const { mood } = period;

      if (period.seed === activeMoodSeed) {
        scheduleMoodRefresh(now);
        return;
      }

      const caption = getMappedValue(captions, mood, "mood.json");
      const imageId = Number(getMappedValue(moodImages, mood, "mood_img.json"));

      if (!isValidImageId(imageId) || !isPlainObject(images)) {
        throw new Error("The daily mood image mapping is invalid.");
      }
      const filename = images[String(imageId)];
      if (typeof filename !== "string" || filename.trim() === "") {
        throw new Error(`images.json does not contain image ${imageId}.`);
      }

      const source = `/jeff/images/${encodeURIComponent(filename.trim())}`;
      const preloaded = await preloadImage(source);
      const image = document.getElementById("mood-image");
      const figure = document.getElementById("mood-figure");

      displayMeter(mood, period, now);
      image.src = preloaded.src;
      image.alt = `Jeff illustrating his current ${mood}% mood`;
      document.getElementById("mood-caption").textContent = caption;
      figure.hidden = false;
      activeMoodSeed = period.seed;
      recordDisplayedImage(imageId);
      scheduleMoodRefresh(now);
    } catch (error) {
      console.error(error);
      showError();
    } finally {
      loading = false;
      document.getElementById("mood-page").setAttribute("aria-busy", "false");
    }
  }

  function dismissCompletion() {
    saveCompletionAcknowledged(true);
    document.getElementById("collection-complete-overlay").hidden = true;
    document.getElementById("site-menu-toggle")?.focus();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("new-indicator").addEventListener("animationend", function (event) {
      if (event.target === this) {
        this.classList.remove("show");
        this.setAttribute("aria-hidden", "true");
      }
    });
    document.getElementById("collection-continue-button").addEventListener("click", dismissCompletion);
    document.getElementById("mood-retry-button").addEventListener("click", initializeMood);
    initializeMood();
  }, { once: true });

  window.addEventListener("pageshow", redirectIfMoodIsLocked);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEYS.viewed) {
      redirectIfMoodIsLocked();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      initializeMood();
    }
  });
  document.addEventListener("jeff:history-cleared", redirectIfMoodIsLocked);
})();
