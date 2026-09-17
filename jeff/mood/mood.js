(() => {
  "use strict";

  const MOOD_UNLOCK_REQUIREMENT = 20;
  const TOTAL_IMAGE_GOAL = 150;
  const RECENT_IMAGE_LIMIT = 10;
  const ROOT_PAGE = "/jeff/";
  const MOOD_TIME_ZONE = "America/New_York";
  const MOOD_INTERVAL = 3;
  const MOOD_HOURS = Array.from(
    { length: 24 / MOOD_INTERVAL },
    (_, index) => index * MOOD_INTERVAL,
  );
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
    moods: "/jeff/mood/mood.json",
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

  async function fetchMoodsAndTime() {
    const url = new URL(SOURCES.moods, window.location.href);
    const cacheKey = window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    url.searchParams.set("_clock", cacheKey);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${SOURCES.moods}: ${response.status}`);
    }

    const dateHeader = response.headers.get("Date");
    const serverTime = dateHeader ? new Date(dateHeader) : new Date(Number.NaN);

    if (Number.isNaN(serverTime.getTime())) {
      console.warn("A shared server time was unavailable; using this device's clock.");
    }

    return {
      moods: await response.json(),
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

  function getDayMoodIndexes(dateParts, count) {
    if (count === 1) {
      return MOOD_HOURS.map(() => 0);
    }
    const used = new Set();
    let previous = null;

    return MOOD_HOURS.map((hour) => {
      if (used.size === count) {
        used.clear();
        used.add(previous);
      }
      const seed = makeMoodSeed({ ...dateParts, hour });
      const options = Array.from({ length: count }, (_, index) => index)
        .filter((index) => !used.has(index));
      const index = options[hashSeed(seed) % options.length];
      used.add(index);
      previous = index;
      return index;
    });
  }

  function getMoodPeriod(now, entries) {
    const current = getEasternParts(now);
    const dateParts = { year: current.year, month: current.month, day: current.day };
    const periodHour = Math.floor(current.hour / MOOD_INTERVAL) * MOOD_INTERVAL;
    const period = { ...dateParts, hour: periodHour };
    const count = entries.length;
    let index = 0;

    if (count === 2) {
      // With two entries, alternating is the only way to avoid repeats.
      const calendarTime = Date.UTC(current.year, current.month - 1, current.day, periodHour);
      index = Math.floor(calendarTime / (MOOD_INTERVAL * 3600000)) % 2;
    } else if (count > 2) {
      const moodIndexes = getDayMoodIndexes(dateParts, count);
      const previousDayIndexes = getDayMoodIndexes(shiftCalendarDate(dateParts, -1), count);
      const previousLast = previousDayIndexes[previousDayIndexes.length - 1];

      if (moodIndexes[0] === previousLast) {
        if (count >= MOOD_HOURS.length && MOOD_HOURS.length > 2) {
          [moodIndexes[0], moodIndexes[1]] = [moodIndexes[1], moodIndexes[0]];
        } else {
          // Change only the first slot so the daily boundary stays deterministic.
          const options = Array.from({ length: count }, (_, value) => value)
            .filter((value) => value !== previousLast && value !== moodIndexes[1]);
          const firstSeed = makeMoodSeed({ ...dateParts, hour: 0 });
          moodIndexes[0] = options[hashSeed(firstSeed) % options.length];
        }
      }
      index = moodIndexes[periodHour / MOOD_INTERVAL];
    }

    return {
      ...period,
      seed: makeMoodSeed(period),
      ...entries[index],
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

  function getMoodEntries(map) {
    if (!isPlainObject(map)) {
      throw new Error("mood.json must contain a JSON object.");
    }
    const entries = Object.entries(map).map(([rawMood, entry]) => {
      const mood = Number(rawMood);
      if (rawMood.trim() === "" || !Number.isFinite(mood) || mood < 0 || mood > 100) {
        throw new Error(`Invalid mood percentage: "${rawMood}". Use a number from 0 to 100.`);
      }
      if (
        !isPlainObject(entry) ||
        typeof entry.caption !== "string" ||
        entry.caption.trim() === "" ||
        !["string", "number"].includes(typeof entry.img) ||
        !isValidImageId(Number(entry.img))
      ) {
        throw new Error(`Mood ${rawMood} needs a caption and an image ID from 1 to ${TOTAL_IMAGE_GOAL}.`);
      }
      return { mood, caption: entry.caption.trim(), imageId: Number(entry.img) };
    }).sort((a, b) => a.mood - b.mood);

    if (entries.length === 0 || new Set(entries.map((entry) => entry.mood)).size !== entries.length) {
      throw new Error("mood.json must contain at least one entry with unique percentages.");
    }
    return entries;
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
      const [{ moods, now }, images] = await Promise.all([
        fetchMoodsAndTime(),
        fetchJson(SOURCES.images),
      ]);
      const period = getMoodPeriod(now, getMoodEntries(moods));
      const { mood, caption, imageId } = period;

      if (period.seed === activeMoodSeed) {
        scheduleMoodRefresh(now);
        return;
      }

      if (!isPlainObject(images)) {
        throw new Error("images.json must map numerical IDs to filenames.");
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
