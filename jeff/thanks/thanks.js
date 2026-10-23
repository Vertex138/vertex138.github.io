(() => {
  "use strict";

  const ROOT = "/jeff/";
  const VISIT_KEY = "thanksFirstViewComplete";
  const UNLOCK_SECONDS = 180;
  const root = document.documentElement;

  function stored(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  function hasAccess() {
    try {
      const ids = JSON.parse(stored("viewedImages") || "[]");
      return Array.isArray(ids) && new Set(ids.map(Number).filter(id =>
        Number.isInteger(id) && id >= 1 && id <= 150
      )).size === 150;
    } catch { return false; }
  }

  if (!hasAccess()) {
    window.location.replace(ROOT);
    return;
  }

  let firstVisit = stored(VISIT_KEY) !== "true";
  root.classList.toggle("thanks-first-visit", firstVisit);
  root.classList.toggle("thanks-return-visit", !firstVisit);
  root.classList.toggle("thanks-dark", !firstVisit);
  const motionPreference = stored("reducedMotionPreference");
  root.classList.toggle("reduced-motion", motionPreference === "true" ||
    (motionPreference === null && window.matchMedia("(prefers-reduced-motion: reduce)").matches));

  function initialize() {
    const video = document.getElementById("thanks-video");
    const player = document.getElementById("thanks-player");
    const playButton = document.getElementById("thanks-play");
    const retryButton = document.getElementById("thanks-retry");
    const status = document.getElementById("thanks-status");
    const error = document.getElementById("thanks-error");
    const menuToggle = document.getElementById("site-menu-toggle");
    let started = false;
    let lastPosition = 0;
    let correctingSeek = false;
    let changingSource = false;
    let sourceRequest = 0;
    let startRequest = 0;

    function setMenuLocked(locked) {
      if (locked && root.classList.contains("site-menu-open")) menuToggle?.click();
      root.classList.toggle("thanks-menu-locked", locked);
      if (!menuToggle) return;
      menuToggle.disabled = locked;
      menuToggle.inert = locked;
      if (locked) menuToggle.setAttribute("aria-hidden", "true");
      else menuToggle.removeAttribute("aria-hidden");
    }

    function applyControls() {
      video.controls = !firstVisit;
      video.disablePictureInPicture = firstVisit;
      video.disableRemotePlayback = firstVisit;
      video.tabIndex = firstVisit ? -1 : 0;
      if (firstVisit) video.playbackRate = 1;
    }

    function finishFirstView() {
      if (!firstVisit) return;
      firstVisit = false;
      try { localStorage.setItem(VISIT_KEY, "true"); }
      catch (error) { console.warn("Could not save the thank-you visit:", error); }
      root.classList.remove("thanks-first-visit");
      root.classList.add("thanks-return-visit");
      playButton.hidden = true;
      status.textContent = "";
      applyControls();
      setMenuLocked(false);
    }

    function showError() {
      startRequest++;
      changingSource = false;
      error.hidden = false;
      playButton.hidden = true;
      status.textContent = "";
      setMenuLocked(false);
    }

    async function play() {
      const request = ++startRequest;
      playButton.disabled = true;
      try {
        await video.play();
      } catch (failure) {
        if (request !== startRequest || changingSource) return;
        if (video.error) showError();
        else {
          playButton.hidden = false;
          playButton.textContent = started ? "Resume video" : "Play Jeff's movie";
          status.textContent = "Tap Play to start or resume Jeff's movie.";
          // A rejected play attempt must never leave navigation locked.
          setMenuLocked(false);
        }
      } finally {
        if (request === startRequest) playButton.disabled = false;
      }
    }

    function loadVideo() {
      const dataSaver = window.JeffSite?.dataSaverEnabled() ??
        ["on", "auto"].includes(stored("dataSaverPreference"));
      const source = ROOT + "thanks/" + (dataSaver ? "JeffMovie_low.webm" : "JeffMovie.webm");
      const resumeAt = firstVisit ? lastPosition : video.currentTime;
      const resumePlayback = started && !video.paused && !video.ended;
      const request = ++sourceRequest;
      startRequest++;
      changingSource = true;
      correctingSeek = false;
      error.hidden = true;
      playButton.disabled = false;
      playButton.hidden = !firstVisit || started;
      status.textContent = "Loading Jeff's movie…";
      video.src = source;

      video.addEventListener("loadedmetadata", () => {
        if (request !== sourceRequest) return;
        const position = Number.isFinite(video.duration)
          ? Math.min(resumeAt, Math.max(0, video.duration - 0.1)) : resumeAt;
        const restored = () => {
          if (request !== sourceRequest) return;
          changingSource = false;
          lastPosition = position;
          status.textContent = "";
          if (resumePlayback) void play();
          else if (firstVisit) {
            playButton.textContent = started ? "Resume video" : "Play Jeff's movie";
            playButton.hidden = false;
          }
        };
        if (position > 0) {
          video.addEventListener("seeked", restored, { once: true });
          video.currentTime = position;
        } else restored();
      }, { once: true });
      video.load();
    }

    video.addEventListener("playing", () => {
      started = true;
      playButton.hidden = true;
      playButton.disabled = false;
      status.textContent = "";
      if (firstVisit) setMenuLocked(true);
    });

    video.addEventListener("timeupdate", () => {
      if (!firstVisit || !started || video.seeking || correctingSeek || changingSource) return;
      lastPosition = video.currentTime;
      if (lastPosition >= UNLOCK_SECONDS) finishFirstView();
    });

    // Native controls are hidden initially; reject seeking from media shortcuts too.
    video.addEventListener("seeking", () => {
      if (!firstVisit || changingSource || correctingSeek) return;
      if (Math.abs(video.currentTime - lastPosition) > 0.25) {
        correctingSeek = true;
        video.currentTime = lastPosition;
      }
    });
    video.addEventListener("seeked", () => { correctingSeek = false; });
    video.addEventListener("ratechange", () => {
      if (firstVisit && video.playbackRate !== 1) video.playbackRate = 1;
    });

    video.addEventListener("pause", () => {
      if (!firstVisit || !started || video.ended || video.error || changingSource) return;
      playButton.disabled = false;
      playButton.textContent = "Resume video";
      playButton.hidden = false;
    });
    video.addEventListener("waiting", () => {
      if (started && error.hidden) status.textContent = "Buffering Jeff's movie…";
    });
    video.addEventListener("error", showError);
    video.addEventListener("ended", () => {
      if (!changingSource && !correctingSeek) finishFirstView();
    });
    video.addEventListener("contextmenu", event => {
      if (firstVisit) event.preventDefault();
    });
    video.addEventListener("keydown", event => {
      if (firstVisit && [" ", "k", "K", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
      }
    });

    playButton.addEventListener("click", play);
    retryButton.addEventListener("click", loadVideo);
    document.addEventListener("jeff:data-saver-changed", loadVideo);
    document.addEventListener("jeff:history-cleared", () => window.location.replace(ROOT));
    window.addEventListener("storage", event => {
      if (event.key === "viewedImages" || event.key === null) {
        if (!hasAccess()) window.location.replace(ROOT);
      }
      if (event.key === VISIT_KEY && event.newValue === "true") finishFirstView();
    });

    applyControls();
    loadVideo();
    root.classList.remove("thanks-pending");
    if (!firstVisit || root.classList.contains("reduced-motion")) {
      root.classList.add("thanks-dark");
      player.classList.add("is-visible");
      return;
    }

    // Paint the tan starting color before beginning the fade to black.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add("thanks-dark");
      const duration = parseFloat(getComputedStyle(document.body).transitionDuration) * 1000;
      window.setTimeout(() => player.classList.add("is-visible"), duration + 50);
    }));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else initialize();
})();