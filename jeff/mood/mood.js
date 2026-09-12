(() => {
  "use strict";

  const MOOD_UNLOCK_REQUIREMENT = 15;
  const TOTAL_IMAGE_GOAL = 150;
  const RECENT_IMAGE_LIMIT = 10;
  const ROOT_PAGE = "/jeff/";
  const SOURCES = {
    today: "/jeff/mood/today.txt",
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

  async function fetchText(source, noStore = false) {
    const response = await fetch(source, noStore ? { cache: "no-store" } : undefined);
    if (!response.ok) {
      throw new Error(`Could not load ${source}: ${response.status}`);
    }
    return response.text();
  }

  async function fetchJson(source) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Could not load ${source}: ${response.status}`);
    }
    return response.json();
  }

  function validateMood(value) {
    const mood = Number(value.trim());
    if (!Number.isInteger(mood) || mood < 5 || mood > 100 || mood % 5 !== 0) {
      throw new Error("today.txt must contain a multiple of 5 from 5 through 100.");
    }
    return mood;
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

  function displayMeter(mood) {
    const meter = document.getElementById("mood-meter");
    const fill = document.getElementById("mood-meter-fill");
    const value = document.getElementById("mood-value");
    const color = hsvToRgb(mood, 0.7, 0.9);

    document.documentElement.style.setProperty("--mood-color", color);
    value.textContent = `${mood}%`;
    meter.setAttribute("aria-label", `Jeff's mood today is ${mood} percent`);

    const applyFill = () => {
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
      const [todayText, captions, moodImages, images] = await Promise.all([
        fetchText(SOURCES.today, true),
        fetchJson(SOURCES.captions),
        fetchJson(SOURCES.moodImages),
        fetchJson(SOURCES.images),
      ]);
      const mood = validateMood(todayText);
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

      displayMeter(mood);
      image.src = preloaded.src;
      image.alt = `Jeff illustrating today's ${mood}% mood`;
      document.getElementById("mood-caption").textContent = caption;
      figure.hidden = false;
      figure.classList.remove("slide-in", "fade-in");
      figure.classList.add(reducedMotionEnabled() ? "fade-in" : "slide-in");
      recordDisplayedImage(imageId);
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
  document.addEventListener("jeff:history-cleared", redirectIfMoodIsLocked);
})();
