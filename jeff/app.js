const RECENT_IMAGE_LIMIT = 10;

const TOTAL_IMAGE_GOAL = 150;

const NEW_IMAGE_GUARANTEE_INTERVAL = 3;

const NEW_IMAGE_GUARANTEE_STEP = .05;

const IMAGE_DIRECTORY = "images/";

const RECENT_IMAGES_KEY = "recentImages";

const VIEWED_IMAGES_KEY = "viewedImages";

const NO_NEW_STREAK_KEY = "noNewImageStreak";

const COLLECTION_COMPLETE_ACKNOWLEDGED_KEY = "collectionCompleteAcknowledged";

const INTRO_ACKNOWLEDGED_KEY = "introductionAcknowledged";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let imageMap = {};

let availableImageIds = [];

let transitionInProgress = false;

let countAnimationTimeout = null;

let pendingRetryAction = null;

function reducedMotionEnabled() {
  if (window.JeffSite && typeof window.JeffSite.reducedMotionEnabled === "function") {
    return window.JeffSite.reducedMotionEnabled();
  }
  return reducedMotionQuery.matches;
}

function consumeForceNewRequest() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("forceNew") !== "1") {
    return false;
  }
  url.searchParams.delete("forceNew");
  try {
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (error) {
    console.warn("Could not remove the FORCE NEW URL parameter:", error);
  }
  return true;
}

function isValidImageId(value) {
  return Number.isInteger(value) && value >= 1 && value <= TOTAL_IMAGE_GOAL;
}

function getStoredImageIds(key) {
  try {
    const savedValues = localStorage.getItem(key);
    if (!savedValues) {
      return [];
    }
    const parsedValues = JSON.parse(savedValues);
    if (!Array.isArray(parsedValues)) {
      return [];
    }
    return parsedValues.filter(isValidImageId);
  } catch (error) {
    console.warn(`Could not retrieve "${key}" from localStorage:`, error);
    return [];
  }
}

function saveStoredImageIds(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch (error) {
    console.warn(`Could not save "${key}" to localStorage:`, error);
  }
}

function getNoNewImageStreak() {
  try {
    const savedValue = Number(localStorage.getItem(NO_NEW_STREAK_KEY));
    if (!Number.isInteger(savedValue) || savedValue < 0) {
      return 0;
    }
    return savedValue;
  } catch (error) {
    console.warn("Could not retrieve the no-NEW image streak:", error);
    return 0;
  }
}

function saveNoNewImageStreak(streak) {
  try {
    localStorage.setItem(NO_NEW_STREAK_KEY, String(streak));
  } catch (error) {
    console.warn("Could not save the no-NEW image streak:", error);
  }
}

function getRecentImageIds() {
  return getStoredImageIds(RECENT_IMAGES_KEY).slice(-RECENT_IMAGE_LIMIT);
}

function getViewedImageIds() {
  return [ ...new Set(getStoredImageIds(VIEWED_IMAGES_KEY)) ];
}

function getGalleryUnlockRequirement() {
  const galleryLink = document.querySelector(`[data-href="/jeff/gallery"], ` + `[data-href="/jeff/gallery/"]`);
  const sharedRequirement = Number(galleryLink?.dataset.unlock);
  return Number.isInteger(sharedRequirement) && sharedRequirement > 0 ? sharedRequirement : 5;
}

function updateTapGuidance(viewedCount = getViewedImageIds().length) {
  const galleryLocked = viewedCount < getGalleryUnlockRequirement();
  document.documentElement.classList.toggle("gallery-locked", galleryLocked);
  document.getElementById("tap-guidance").hidden = !galleryLocked;
  return !galleryLocked;
}

function introductionWasAcknowledged() {
  try {
    return localStorage.getItem(INTRO_ACKNOWLEDGED_KEY) === "true";
  } catch (error) {
    console.warn("Could not retrieve the introduction state:", error);
    return false;
  }
}

function showIntroductionIfNeeded() {
  if (introductionWasAcknowledged()) {
    return;
  }
  document.getElementById("intro-overlay").hidden = false;
  requestAnimationFrame(() => {
    document.getElementById("intro-dismiss-button").focus();
  });
}

function dismissIntroduction() {
  try {
    localStorage.setItem(INTRO_ACKNOWLEDGED_KEY, "true");
  } catch (error) {
    console.warn("Could not save the introduction state:", error);
  }
  document.getElementById("intro-overlay").hidden = true;
  document.getElementById("site-menu-toggle")?.focus();
}

function rememberRecentImage(imageId) {
  let recentIds = getRecentImageIds();
  recentIds = recentIds.filter(savedId => savedId !== imageId);
  recentIds.push(imageId);
  saveStoredImageIds(RECENT_IMAGES_KEY, recentIds.slice(-RECENT_IMAGE_LIMIT));
}

function rememberViewedImage(imageId) {
  const viewedIds = getViewedImageIds();
  if (viewedIds.includes(imageId)) {
    return {
      isNew: false,
      viewedCount: viewedIds.length
    };
  }
  viewedIds.push(imageId);
  saveStoredImageIds(VIEWED_IMAGES_KEY, viewedIds);
  return {
    isNew: true,
    viewedCount: viewedIds.length
  };
}

function getAvailableImageIds(imageData) {
  return Object.entries(imageData).filter(([rawId, filename]) => {
    const imageId = Number(rawId);
    return isValidImageId(imageId) && typeof filename === "string" && filename.trim() !== "";
  }).map(([rawId]) => Number(rawId));
}

function chooseRandomImageId() {
  let recentIds = getRecentImageIds().filter(imageId => availableImageIds.includes(imageId));
  const maximumExclusions = Math.min(RECENT_IMAGE_LIMIT, Math.max(availableImageIds.length - 1, 0));
  if (maximumExclusions > 0) {
    recentIds = recentIds.slice(-maximumExclusions);
  } else {
    recentIds = [];
  }
  const possibleIds = availableImageIds.filter(imageId => !recentIds.includes(imageId));
  return possibleIds[Math.floor(Math.random() * possibleIds.length)];
}

function getUnseenImageIds() {
  const viewedIds = new Set(getViewedImageIds());
  return availableImageIds.filter(imageId => !viewedIds.has(imageId));
}

function getNewImageGuaranteeChance() {
  const completedIntervals = Math.floor(getNoNewImageStreak() / NEW_IMAGE_GUARANTEE_INTERVAL);
  return Math.min(completedIntervals * NEW_IMAGE_GUARANTEE_STEP, 1);
}

function chooseNextImageSelection(forceNew = false) {
  const unseenIds = getUnseenImageIds();
  if (unseenIds.length > 0) {
    const guaranteeChance = getNewImageGuaranteeChance();
    if (forceNew || Math.random() < guaranteeChance) {
      return {
        imageId: unseenIds[Math.floor(Math.random() * unseenIds.length)],
        wasGuaranteed: true
      };
    }
  }
  return {
    imageId: chooseRandomImageId(),
    wasGuaranteed: false
  };
}

function updateForceNewButtonState() {
  const button = document.getElementById("force-new-button");
  if (!button) {
    return;
  }
  const allImagesViewed = availableImageIds.length > 0 && getUnseenImageIds().length === 0;
  if (window.JeffSite) {
    window.JeffSite.setForceNewReady(availableImageIds.length > 0);
  }
  button.disabled = availableImageIds.length === 0 || allImagesViewed;
  button.title = allImagesViewed ? "All images have already been discovered." : "Display an image you have not viewed before.";
}

function updateDisplayedImageId(imageId) {
  const tag = document.getElementById("image-id-tag");
  tag.textContent = `#${String(imageId).padStart(3, "0")}`;
}

function collectionIsComplete() {
  return availableImageIds.length > 0 && getUnseenImageIds().length === 0;
}

function collectionCompletionWasAcknowledged() {
  try {
    return localStorage.getItem(COLLECTION_COMPLETE_ACKNOWLEDGED_KEY) === "true";
  } catch (error) {
    console.warn("Could not retrieve the collection-complete state:", error);
    return false;
  }
}

function saveCollectionCompletionAcknowledged(acknowledged) {
  try {
    if (acknowledged) {
      localStorage.setItem(COLLECTION_COMPLETE_ACKNOWLEDGED_KEY, "true");
    } else {
      localStorage.removeItem(COLLECTION_COMPLETE_ACKNOWLEDGED_KEY);
    }
  } catch (error) {
    console.warn("Could not save the collection-complete state:", error);
  }
}

function updateCollectionCompleteState() {
  const overlay = document.getElementById("collection-complete-overlay");
  const star = document.getElementById("collection-complete-star");
  if (!collectionIsComplete()) {
    star.hidden = true;
    overlay.hidden = true;
    saveCollectionCompletionAcknowledged(false);
    return;
  }
  star.hidden = false;
  if (!collectionCompletionWasAcknowledged()) {
    overlay.hidden = false;
    requestAnimationFrame(() => {
      document.getElementById("collection-continue-button").focus();
    });
  }
}

function dismissCollectionCompleteOverlay() {
  saveCollectionCompletionAcknowledged(true);
  document.getElementById("collection-complete-overlay").hidden = true;
  document.getElementById("random-image").focus();
}

function showErrorState(retryAction) {
  pendingRetryAction = retryAction;
  document.getElementById("error-overlay").hidden = false;
  requestAnimationFrame(() => {
    document.getElementById("retry-button").focus();
  });
}

function hideErrorState() {
  document.getElementById("error-overlay").hidden = true;
}

async function retryLastFailedAction() {
  const retryAction = pendingRetryAction;
  pendingRetryAction = null;
  hideErrorState();
  if (retryAction) {
    await retryAction();
  }
}

function clearImageAnimationClasses(element) {
  element.classList.remove("slide-in", "slide-out", "fade-in", "fade-out");
}

function playImageAnimation(element, animationClass, expectedDuration) {
  clearImageAnimationClasses(element);
  return new Promise(resolve => {
    let finished = false;
    let fallbackTimer = null;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
      }
      element.removeEventListener("animationend", handleAnimationEnd);
      resolve();
    };
    const handleAnimationEnd = event => {
      if (event.target === element) {
        finish();
      }
    };
    element.addEventListener("animationend", handleAnimationEnd);
    element.classList.add(animationClass);
    fallbackTimer = setTimeout(finish, expectedDuration + 200);
  });
}

function preloadImage(source) {
  return new Promise((resolve, reject) => {
    const preloader = new Image;
    preloader.onload = () => {
      resolve(preloader);
    };
    preloader.onerror = () => {
      preloader.removeAttribute("src");
      reject(new Error(`Could not preload image: ${source}`));
    };
    preloader.src = source;
  });
}

function applyPreloadedImage(img, preloader) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const source = preloader.src;
    const finish = callback => {
      if (finished) {
        return;
      }
      finished = true;
      img.onload = null;
      img.onerror = null;
      callback();
    };
    img.onload = () => {
      finish(resolve);
    };
    img.onerror = () => {
      finish(() => {
        reject(new Error(`Could not display image: ${source}`));
      });
    };
    img.src = source;
    if (img.complete && img.naturalWidth > 0) {
      queueMicrotask(() => {
        finish(resolve);
      });
    }
  });
}

function releasePreloader(preloader) {
  if (!preloader) {
    return;
  }
  preloader.onload = null;
  preloader.onerror = null;
  preloader.removeAttribute("src");
}

function showNewIndicator(viewedCount, wasGuaranteed = false) {
  const indicator = document.getElementById("new-indicator");
  const symbol = document.getElementById("new-symbol");
  const count = document.getElementById("viewed-count");
  const goal = document.getElementById("image-goal");
  clearTimeout(countAnimationTimeout);
  symbol.textContent = wasGuaranteed ? "☆" : "★";
  goal.textContent = TOTAL_IMAGE_GOAL;
  count.textContent = Math.max(viewedCount - 1, 0);
  indicator.classList.remove("show");
  count.classList.remove("increment");
  void indicator.offsetWidth;
  indicator.setAttribute("aria-hidden", "false");
  indicator.classList.add("show");
  countAnimationTimeout = setTimeout(() => {
    count.textContent = viewedCount;
    count.classList.add("increment");
  }, 220);
}

function hideNewIndicator() {
  const indicator = document.getElementById("new-indicator");
  const count = document.getElementById("viewed-count");
  clearTimeout(countAnimationTimeout);
  indicator.classList.remove("show");
  count.classList.remove("increment");
  indicator.setAttribute("aria-hidden", "true");
}

document.getElementById("new-indicator").addEventListener("animationend", function(event) {
  if (event.target !== this) {
    return;
  }
  this.classList.remove("show");
  this.setAttribute("aria-hidden", "true");
});

function recordDisplayedImage(imageId, wasGuaranteed = false) {
  updateDisplayedImageId(imageId);
  rememberRecentImage(imageId);
  const viewingResult = rememberViewedImage(imageId);
  hideNewIndicator();
  const galleryUnlocked = updateTapGuidance(viewingResult.viewedCount);
  if (viewingResult.isNew) {
    saveNoNewImageStreak(0);
    if (galleryUnlocked) {
      showNewIndicator(viewingResult.viewedCount, wasGuaranteed);
    }
  } else {
    saveNoNewImageStreak(getNoNewImageStreak() + 1);
  }
  updateForceNewButtonState();
  updateCollectionCompleteState();
  document.dispatchEvent(new CustomEvent("jeff:progress-changed"));
}

async function displayInitialImage() {
  const img = document.getElementById("random-image");
  const imageContainer = document.getElementById("image-container");
  const selection = chooseNextImageSelection(consumeForceNewRequest());
  const imageId = selection.imageId;
  const filename = imageMap[imageId];
  const source = IMAGE_DIRECTORY + filename;
  let preloader = null;
  transitionInProgress = true;
  img.classList.add("is-transitioning");
  try {
    preloader = await preloadImage(source);
    await applyPreloadedImage(img, preloader);
    recordDisplayedImage(imageId, selection.wasGuaranteed);
    const incomingAnimation = reducedMotionEnabled() ? "fade-in" : "slide-in";
    const incomingDuration = reducedMotionEnabled() ? 350 : 550;
    await playImageAnimation(imageContainer, incomingAnimation, incomingDuration);
  } finally {
    releasePreloader(preloader);
    img.classList.remove("is-transitioning");
    transitionInProgress = false;
  }
}

async function displayNextImage(forceNew = false, retrySelection = null) {
  if (transitionInProgress) {
    return;
  }
  const img = document.getElementById("random-image");
  const imageContainer = document.getElementById("image-container");
  const selection = retrySelection || chooseNextImageSelection(forceNew);
  const imageId = selection.imageId;
  const filename = imageMap[imageId];
  const source = IMAGE_DIRECTORY + filename;
  let preloader = null;
  transitionInProgress = true;
  img.classList.add("is-transitioning");
  try {
    const useReducedMotion = reducedMotionEnabled();
    const outgoingAnimation = useReducedMotion ? "fade-out" : "slide-out";
    const outgoingDuration = useReducedMotion ? 350 : 450;
    await playImageAnimation(imageContainer, outgoingAnimation, outgoingDuration);
    preloader = await preloadImage(source);
    img.removeAttribute("src");
    await applyPreloadedImage(img, preloader);
    recordDisplayedImage(imageId, selection.wasGuaranteed);
    const incomingAnimation = useReducedMotion ? "fade-in" : "slide-in";
    const incomingDuration = useReducedMotion ? 350 : 550;
    await playImageAnimation(imageContainer, incomingAnimation, incomingDuration);
    pendingRetryAction = null;
  } catch (error) {
    console.error(error);
    clearImageAnimationClasses(imageContainer);
    showErrorState(() => displayNextImage(forceNew, selection));
  } finally {
    releasePreloader(preloader);
    img.classList.remove("is-transitioning");
    transitionInProgress = false;
  }
}

async function initializePage() {
  if (window.JeffSite) {
    window.JeffSite.setForceNewReady(false);
  }
  try {
    const response = await fetch("images.json");
    if (!response.ok) {
      throw new Error(`Could not load images.json: ${response.status}`);
    }
    imageMap = await response.json();
    if (imageMap === null || typeof imageMap !== "object" || Array.isArray(imageMap)) {
      throw new Error("images.json must map numerical IDs to filenames.");
    }
    availableImageIds = getAvailableImageIds(imageMap);
    if (availableImageIds.length === 0) {
      throw new Error("images.json does not contain any valid image IDs.");
    }
    updateForceNewButtonState();
    await displayInitialImage();
    pendingRetryAction = null;
  } catch (error) {
    console.error(error);
    showErrorState(() => initializePage());
  }
}

document.getElementById("random-image").addEventListener("click", () => displayNextImage(false));

document.addEventListener("jeff:force-new", event => {
  event.preventDefault();
  displayNextImage(true);
});

document.addEventListener("jeff:history-cleared", () => {
  hideNewIndicator();
  updateTapGuidance(0);
  updateForceNewButtonState();
  updateCollectionCompleteState();
});

document.getElementById("collection-continue-button").addEventListener("click", dismissCollectionCompleteOverlay);

document.getElementById("retry-button").addEventListener("click", retryLastFailedAction);

document.getElementById("intro-dismiss-button").addEventListener("click", dismissIntroduction);

document.getElementById("intro-overlay").addEventListener("keydown", event => {
  if (event.key === "Escape") {
    dismissIntroduction();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    document.getElementById("intro-dismiss-button").focus();
  }
});

showIntroductionIfNeeded();

initializePage();