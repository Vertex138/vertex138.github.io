(() => {
  "use strict";
  const TOTAL_IMAGE_GOAL = 150;
  const VIEWED_IMAGES_KEY = "viewedImages";
  const SITE_DIRECTORY = "/jeff/";
  const THUMB_DIRECTORY = `${SITE_DIRECTORY}thumbs/`;
  const IMAGE_DIRECTORY = `${SITE_DIRECTORY}images/`;
  const THUMB_MAP_SOURCE = `${SITE_DIRECTORY}thumbs.json`;
  const IMAGE_MAP_SOURCE = `${SITE_DIRECTORY}images.json`;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const grid = document.getElementById("gallery-grid");
  const progress = document.getElementById("gallery-progress");
  const sortControl = document.getElementById("gallery-sort");
  const errorPanel = document.getElementById("gallery-error");
  const retryButton = document.getElementById("gallery-retry-button");
  const viewer = document.getElementById("gallery-viewer");
  const viewerClose = document.getElementById("gallery-viewer-close");
  const viewerStatus = document.getElementById("gallery-viewer-status");
  const viewerFigure = document.getElementById("gallery-viewer-figure");
  const fullImage = document.getElementById("gallery-full-image");
  const fullImageId = document.getElementById("gallery-full-id");
  const previousButton = document.getElementById("gallery-previous");
  const nextButton = document.getElementById("gallery-next");
  const viewerNavigation = document.getElementById("gallery-viewer-navigation");
  const cardByImageId = new Map;
  let thumbnailMap = {};
  let imageMap = {};
  let loadObserver = null;
  let thumbnailOpacityFrame = null;
  let activeThumbnail = null;
  let activeImageId = null;
  let viewerState = "closed";
  let viewerRequestId = 0;
  let cancelViewerAnimation = null;
  function isValidImageId(value) {
    return Number.isInteger(value) && value >= 1 && value <= TOTAL_IMAGE_GOAL;
  }
  function formatImageId(imageId) {
    return `#${String(imageId).padStart(3, "0")}`;
  }
  function reducedMotionEnabled() {
    if (window.JeffSite && typeof window.JeffSite.reducedMotionEnabled === "function") {
      return window.JeffSite.reducedMotionEnabled();
    }
    return reducedMotionQuery.matches;
  }
  function getViewedImageIds() {
    try {
      const storedIds = JSON.parse(localStorage.getItem(VIEWED_IMAGES_KEY) || "[]");
      if (!Array.isArray(storedIds)) {
        return [];
      }
      return [ ...new Set(storedIds.map(Number).filter(isValidImageId)) ];
    } catch (error) {
      console.warn("Could not retrieve the viewed image history:", error);
      return [];
    }
  }
  function normalizeImageMap(rawMap, sourceName) {
    if (rawMap === null || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      throw new Error(`${sourceName} must map numerical IDs to filenames.`);
    }
    return Object.fromEntries(Object.entries(rawMap).map(([rawId, filename]) => [ Number(rawId), filename ]).filter(([imageId, filename]) => isValidImageId(imageId) && typeof filename === "string" && filename.trim() !== ""));
  }
  async function fetchImageMap(source, sourceName) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Could not load ${sourceName}: ${response.status}`);
    }
    return normalizeImageMap(await response.json(), sourceName);
  }
  function imageSource(directory, filename) {
    const source = directory + encodeURIComponent(filename);
    return window.JeffSite?.dataSaverUrl(source) ?? source;
  }
  function getThumbnailSource(imageId, unlocked) {
    if (!unlocked || !thumbnailMap[imageId]) {
      return imageSource(THUMB_DIRECTORY, "t_missing.jpg");
    }
    return imageSource(THUMB_DIRECTORY, thumbnailMap[imageId]);
  }
  function unmountThumbnail(card) {
    const frame = card.querySelector(".gallery-thumbnail-frame");
    const image = frame.querySelector("img");
    if (!image) {
      return;
    }
    image.removeAttribute("src");
    image.remove();
    frame.classList.remove("has-image");
  }
  function mountThumbnail(card) {
    const frame = card.querySelector(".gallery-thumbnail-frame");
    if (frame.querySelector("img")) {
      return;
    }
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.draggable = false;
    if (card.dataset.source === getThumbnailSource(Number(card.dataset.imageId), false)) {
      image.dataset.usingFallback = "true";
    }
    image.addEventListener("load", () => {
      frame.classList.add("has-image");
    });
    image.addEventListener("error", () => {
      frame.classList.remove("has-image");
      if (image.dataset.usingFallback === "true") {
        return;
      }
      image.dataset.usingFallback = "true";
      image.src = getThumbnailSource(Number(card.dataset.imageId), false);
    });
    image.src = card.dataset.source;
    frame.append(image);
  }
  function setCardUnlockState(card, unlocked) {
    const imageId = Number(card.dataset.imageId);
    const oldSource = card.dataset.source;
    const newSource = getThumbnailSource(imageId, unlocked);
    card.dataset.unlocked = String(unlocked);
    card.dataset.source = newSource;
    card.classList.toggle("is-locked", !unlocked);
    card.setAttribute("aria-label", unlocked ? `Open image ${formatImageId(imageId)}` : `Image ${formatImageId(imageId)}, not yet discovered`);
    if (oldSource !== undefined && oldSource !== newSource) {
      unmountThumbnail(card);
      if (card.dataset.nearby === "true") {
        mountThumbnail(card);
      }
    }
  }
  function animateLockedCard(card) {
    card.classList.remove("shake-locked");
    void card.offsetWidth;
    card.classList.add("shake-locked");
  }
  function handleThumbnailActivation(card) {
    if (card.dataset.unlocked !== "true") {
      animateLockedCard(card);
      return;
    }
    openFullImage(Number(card.dataset.imageId), card);
  }
  function createThumbnailCard(imageId, unlocked) {
    const card = document.createElement("button");
    const frame = document.createElement("span");
    const placeholder = document.createElement("span");
    const idLabel = document.createElement("span");
    card.type = "button";
    card.className = "gallery-thumbnail";
    card.dataset.imageId = String(imageId);
    card.dataset.nearby = "false";
    frame.className = "gallery-thumbnail-frame";
    placeholder.className = "gallery-thumbnail-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "?";
    idLabel.className = "gallery-thumbnail-id";
    idLabel.textContent = formatImageId(imageId);
    frame.append(placeholder);
    card.append(frame, idLabel);
    setCardUnlockState(card, unlocked);
    card.addEventListener("click", () => {
      handleThumbnailActivation(card);
    });
    card.addEventListener("animationend", event => {
      if (event.animationName === "galleryLockedShake" || event.animationName === "galleryLockedShakeReduced") {
        card.classList.remove("shake-locked");
      }
    });
    return card;
  }
  function updateThumbnailOpacity(card) {
    const frame = card.querySelector(".gallery-thumbnail-frame");
    const bounds = frame.getBoundingClientRect();
    const viewportBottom = document.documentElement.clientHeight;
    let opacity = 1;
    if (bounds.top >= viewportBottom) {
      opacity = 0;
    } else if (bounds.top >= 0 && bounds.bottom > viewportBottom) {
      opacity = (viewportBottom - bounds.top) / bounds.height;
    }
    card.style.opacity = String(Math.max(0, Math.min(1, opacity)));
  }
  function updateNearbyThumbnailOpacities() {
    thumbnailOpacityFrame = null;
    cardByImageId.forEach(card => {
      if (card.dataset.nearby === "true") {
        updateThumbnailOpacity(card);
      }
    });
  }
  function scheduleThumbnailOpacityUpdate() {
    if (thumbnailOpacityFrame !== null) {
      return;
    }
    thumbnailOpacityFrame = requestAnimationFrame(updateNearbyThumbnailOpacities);
  }
  function observeThumbnailCards() {
    const cards = [ ...cardByImageId.values() ];
    if (!("IntersectionObserver" in window)) {
      cards.forEach(card => {
        card.dataset.nearby = "true";
        mountThumbnail(card);
      });
      scheduleThumbnailOpacityUpdate();
      return;
    }
    loadObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const card = entry.target;
        card.dataset.nearby = String(entry.isIntersecting);
        if (entry.isIntersecting) {
          mountThumbnail(card);
          updateThumbnailOpacity(card);
        } else {
          unmountThumbnail(card);
          card.style.opacity = entry.boundingClientRect.top >= document.documentElement.clientHeight ? "0" : "1";
        }
      });
    }, {
      rootMargin: "500px 0px",
      threshold: 0
    });
    cards.forEach(card => {
      loadObserver.observe(card);
    });
    scheduleThumbnailOpacityUpdate();
  }
  function disconnectThumbnailObservers() {
    loadObserver?.disconnect();
    loadObserver = null;
    if (thumbnailOpacityFrame !== null) {
      cancelAnimationFrame(thumbnailOpacityFrame);
      thumbnailOpacityFrame = null;
    }
  }
  function renderGallery() {
    disconnectThumbnailObservers();
    cardByImageId.clear();
    const viewedIds = new Set(getViewedImageIds());
    const fragment = document.createDocumentFragment();
    for (let imageId = 1; imageId <= TOTAL_IMAGE_GOAL; imageId += 1) {
      const card = createThumbnailCard(imageId, viewedIds.has(imageId));
      cardByImageId.set(imageId, card);
      fragment.append(card);
    }
    grid.replaceChildren(fragment);
    grid.setAttribute("aria-busy", "false");
    refreshGalleryUnlocks();
    observeThumbnailCards();
    if (sortControl) sortControl.disabled = false;
  }
  function sortGalleryCards() {
    const mode = sortControl?.value || "numeric-asc";
    const cards = [...cardByImageId.values()].sort((a, b) => {
      const difference = Number(a.dataset.imageId) - Number(b.dataset.imageId);
      if (mode === "numeric-desc") return -difference;
      if (mode === "discovered-first" || mode === "hidden-first") {
        const unlockedDifference = Number(b.dataset.unlocked === "true") - Number(a.dataset.unlocked === "true");
        return (mode === "hidden-first" ? -unlockedDifference : unlockedDifference) || difference;
      }
      return difference;
    });
    if (cards.some((card, index) => grid.children[index] !== card)) {
      const focusedCard = grid.contains(document.activeElement) ? document.activeElement : null;
      grid.append(...cards);
      focusedCard?.focus({ preventScroll: true });
      scheduleThumbnailOpacityUpdate();
    }
    updateViewerNavigation();
  }
  function refreshGalleryUnlocks() {
    if (cardByImageId.size === 0) {
      return;
    }
    const viewedIds = new Set(getViewedImageIds());
    const viewedCount = viewedIds.size;
    const progressText = `${viewedCount} / ${TOTAL_IMAGE_GOAL} discovered`;
    if (viewedCount === TOTAL_IMAGE_GOAL) {
      const createStar = () => {
        const star = document.createElement("span");
        star.className = "gallery-complete-star";
        star.setAttribute("aria-hidden", "true");
        star.textContent = "★";
        return star;
      };
      progress.replaceChildren(createStar(), document.createTextNode(` ${progressText} `), createStar());
      progress.setAttribute("aria-label", `${progressText}. Collection complete.`);
    } else {
      progress.textContent = progressText;
      progress.removeAttribute("aria-label");
    }
    cardByImageId.forEach((card, imageId) => {
      setCardUnlockState(card, viewedIds.has(imageId));
    });
    sortGalleryCards();
  }
  function clearViewerAnimationClasses() {
    cancelViewerAnimation?.();
    viewerFigure.classList.remove(
      "gallery-slide-in-bottom", "gallery-slide-out-bottom",
      "gallery-slide-in-left", "gallery-slide-out-left",
      "gallery-slide-in-right", "gallery-slide-out-right",
      "gallery-fade-in", "gallery-fade-out"
    );
  }
  function fitViewerNavigation() {
    if (!viewerNavigation || !previousButton || !nextButton || viewerFigure.hidden || viewer.hidden) return;
    const width = viewer.clientWidth;
    if (!width) return;
    viewerNavigation.style.width = `${width}px`;
    fullImageId.style.removeProperty("--gallery-id-size");
    const style = getComputedStyle(viewer);
    const leftEdge = parseFloat(style.paddingLeft) || 18;
    const rightEdge = parseFloat(style.paddingRight) || 18;
    viewerNavigation.style.left = `${(rightEdge - leftEdge) / 2}px`;
    const previousWidth = previousButton.offsetWidth;
    const nextWidth = nextButton.offsetWidth;
    const gap = 8;
    let idWidth = fullImageId.getBoundingClientRect().width;
    const available = Math.max(1, width - leftEdge - rightEdge - previousWidth - nextWidth - 2 * gap);
    if (idWidth > available) {
      const size = parseFloat(getComputedStyle(fullImageId).fontSize);
      fullImageId.style.setProperty("--gallery-id-size", `${size * available / idWidth}px`);
      idWidth = fullImageId.getBoundingClientRect().width;
    }
    previousButton.style.left = `${Math.max(leftEdge + previousWidth / 2,
      Math.min(width * 0.25, width / 2 - idWidth / 2 - gap - previousWidth / 2))}px`;
    nextButton.style.left = `${Math.min(width - rightEdge - nextWidth / 2,
      Math.max(width * 0.75, width / 2 + idWidth / 2 + gap + nextWidth / 2))}px`;
  }
  function getViewerNeighbors() {
    const discovered = [...grid.children].filter(card => card.dataset.unlocked === "true");
    const index = discovered.findIndex(card => Number(card.dataset.imageId) === activeImageId);
    return {
      previous: index > 0 ? discovered[index - 1] : null,
      next: index >= 0 ? discovered[index + 1] ?? null : null
    };
  }
  function updateViewerNavigation() {
    const neighbors = getViewerNeighbors();
    for (const [button, card, direction] of [
      [previousButton, neighbors.previous, "Previous"],
      [nextButton, neighbors.next, "Next"]
    ]) {
      if (!button) continue;
      const imageId = card ? Number(card.dataset.imageId) : null;
      button.querySelector("[id]").textContent = imageId === null ? "—" : formatImageId(imageId);
      button.disabled = viewerState !== "open" || imageId === null;
      button.setAttribute("aria-label", imageId === null
        ? `No ${direction.toLowerCase()} discovered image`
        : `${direction} image, ${formatImageId(imageId)}`);
    }
    fitViewerNavigation();
  }
  function navigateFullImage(direction) {
    if (viewerState !== "open") return;
    const card = getViewerNeighbors()[direction < 0 ? "previous" : "next"];
    if (card) openFullImage(Number(card.dataset.imageId), card, direction);
  }
  function playViewerAnimation(animationClass, duration) {
    clearViewerAnimationClasses();
    return new Promise(resolve => {
      let finished = false;
      let fallbackTimer = null;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(fallbackTimer);
        viewerFigure.removeEventListener("animationend", handleAnimationEnd);
        if (cancelViewerAnimation === finish) cancelViewerAnimation = null;
        resolve();
      };
      const handleAnimationEnd = event => {
        if (event.target === viewerFigure) {
          finish();
        }
      };
      viewerFigure.addEventListener("animationend", handleAnimationEnd);
      cancelViewerAnimation = finish;
      viewerFigure.classList.add(animationClass);
      fallbackTimer = setTimeout(finish, duration + 200);
    });
  }
  function preloadImage(source) {
    return new Promise((resolve, reject) => {
      const preloader = new Image;
      preloader.onload = () => resolve(preloader);
      preloader.onerror = () => reject(new Error(`Could not load image: ${source}`));
      preloader.src = source;
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
  function finishClosingViewer() {
    viewer.hidden = true;
    viewerFigure.hidden = true;
    viewerStatus.hidden = false;
    clearViewerAnimationClasses();
    fullImage.removeAttribute("src");
    document.documentElement.classList.remove("gallery-viewer-open");
    viewerState = "closed";
    activeImageId = null;
    updateViewerNavigation();
    activeThumbnail?.focus();
    activeThumbnail = null;
  }
  async function openFullImage(imageId, trigger, direction = 0) {
    if ((viewerState !== "closed" && viewerState !== "open") || !getViewedImageIds().includes(imageId)) {
      return;
    }
    const filename = imageMap[imageId];
    const navigating = viewerState === "open" && direction !== 0;
    if (!navigating) {
      activeThumbnail = trigger;
      activeImageId = imageId;
    }
    viewerState = navigating ? "switching" : "loading";
    updateViewerNavigation();
    viewerRequestId += 1;
    const requestId = viewerRequestId;
    let preloader = null;
    viewer.hidden = false;
    if (!navigating) {
      viewerFigure.hidden = true;
      viewerStatus.hidden = false;
      viewerStatus.textContent = "Loading image…";
    }
    document.documentElement.classList.add("gallery-viewer-open");
    viewerClose.focus();
    try {
      if (!filename) throw new Error(`Image ${formatImageId(imageId)} is missing from images.json.`);
      const useReducedMotion = reducedMotionEnabled();
      const outgoing = navigating
        ? playViewerAnimation(useReducedMotion ? "gallery-fade-out"
          : direction < 0 ? "gallery-slide-out-right" : "gallery-slide-out-left", useReducedMotion ? 350 : 450)
          .then(() => {
            if (requestId === viewerRequestId && viewerState === "switching") {
              viewerState = "loading";
              viewerFigure.hidden = true;
              viewerStatus.hidden = false;
              viewerStatus.textContent = "Loading image…";
            }
          })
        : Promise.resolve();
      await Promise.all([
        preloadImage(imageSource(IMAGE_DIRECTORY, filename)).then(image => { preloader = image; }),
        outgoing
      ]);
      if (requestId !== viewerRequestId) {
        return;
      }
      activeThumbnail = trigger;
      activeImageId = imageId;
      fullImage.src = preloader.src;
      fullImage.alt = `Full-size image ${formatImageId(imageId)}`;
      fullImageId.textContent = formatImageId(imageId);
      viewerStatus.hidden = true;
      viewerFigure.hidden = false;
      viewerState = "opening";
      updateViewerNavigation();
      const incoming = direction < 0 ? "gallery-slide-in-left"
        : direction > 0 ? "gallery-slide-in-right" : "gallery-slide-in-bottom";
      await playViewerAnimation(useReducedMotion ? "gallery-fade-in" : incoming, useReducedMotion ? 350 : 550);
      if (requestId !== viewerRequestId) {
        return;
      }
      clearViewerAnimationClasses();
      viewerState = "open";
      updateViewerNavigation();
      const navigationButton = direction < 0 ? previousButton : direction > 0 ? nextButton : null;
      (navigationButton && !navigationButton.disabled ? navigationButton : fullImage).focus();
    } catch (error) {
      if (requestId !== viewerRequestId) {
        return;
      }
      console.error(error);
      viewerState = "error";
      clearViewerAnimationClasses();
      viewerStatus.hidden = false;
      viewerStatus.textContent = filename ? "This image could not be loaded." : "This image could not be found.";
      viewerFigure.hidden = true;
    } finally {
      releasePreloader(preloader);
    }
  }
  async function closeFullImage() {
    if (viewerState === "closed" || viewerState === "closing") {
      return;
    }
    const requestId = ++viewerRequestId;
    if (viewerState === "loading" || viewerState === "error" || viewerFigure.hidden) {
      finishClosingViewer();
      return;
    }
    viewerState = "closing";
    updateViewerNavigation();
    const useReducedMotion = reducedMotionEnabled();
    await playViewerAnimation(useReducedMotion ? "gallery-fade-out" : "gallery-slide-out-bottom", useReducedMotion ? 350 : 450);
    if (requestId === viewerRequestId) finishClosingViewer();
  }
  function trapViewerFocus(event) {
    if (event.key !== "Tab" || viewer.hidden) {
      return;
    }
    const focusable = viewerFigure.hidden ? [viewerClose]
      : [viewerClose, ...viewerFigure.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  async function initializeGallery() {
    grid.setAttribute("aria-busy", "true");
    if (sortControl) sortControl.disabled = true;
    errorPanel.hidden = true;
    progress.textContent = "Loading gallery…";
    try {
      [thumbnailMap, imageMap] = await Promise.all([ fetchImageMap(THUMB_MAP_SOURCE, "thumbs.json"), fetchImageMap(IMAGE_MAP_SOURCE, "images.json") ]);
      renderGallery();
    } catch (error) {
      console.error(error);
      disconnectThumbnailObservers();
      grid.replaceChildren();
      grid.setAttribute("aria-busy", "false");
      progress.textContent = "Gallery unavailable";
      errorPanel.hidden = false;
    }
  }
  window.addEventListener("scroll", scheduleThumbnailOpacityUpdate, {
    passive: true
  });
  window.addEventListener("resize", scheduleThumbnailOpacityUpdate, {
    passive: true
  });
  window.addEventListener("resize", fitViewerNavigation, { passive: true });
  window.visualViewport?.addEventListener("resize", fitViewerNavigation, { passive: true });
  document.fonts?.ready.then(fitViewerNavigation);
  if ("ResizeObserver" in window) {
    const navigationObserver = new ResizeObserver(fitViewerNavigation);
    [viewer, fullImageId, previousButton, nextButton].filter(Boolean).forEach(element => navigationObserver.observe(element));
  }
  window.addEventListener("storage", event => {
    if (event.key === VIEWED_IMAGES_KEY || event.key === null) {
      refreshGalleryUnlocks();
    }
  });
  window.addEventListener("pageshow", refreshGalleryUnlocks);
  document.addEventListener("jeff:history-cleared", () => {
    refreshGalleryUnlocks();
    if (!viewer.hidden) {
      closeFullImage();
    }
  });
  document.addEventListener("jeff:data-saver-changed", refreshGalleryUnlocks);
  document.addEventListener("jeff:progress-changed", refreshGalleryUnlocks);
  sortControl?.addEventListener("change", sortGalleryCards);
  viewer.addEventListener("click", event => {
    if (event.target === viewer) {
      closeFullImage();
    }
  });
  fullImage.addEventListener("click", closeFullImage);
  fullImage.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      closeFullImage();
    }
  });
  viewerClose.addEventListener("click", closeFullImage);
  previousButton?.addEventListener("click", () => navigateFullImage(-1));
  nextButton?.addEventListener("click", () => navigateFullImage(1));
  retryButton.addEventListener("click", initializeGallery);
  document.addEventListener("keydown", event => {
    if (!viewer.hidden && event.key === "Escape") {
      event.preventDefault();
      closeFullImage();
      return;
    }
    trapViewerFocus(event);
  });
  initializeGallery();
})();