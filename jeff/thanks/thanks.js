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

  function initialize() {
    const video = document.getElementById("thanks-video");
    const player = document.getElementById("thanks-player");
    const playButton = document.getElementById("thanks-play");
    const retryButton = document.getElementById("thanks-retry");
    const status = document.getElementById("thanks-status");
    const error = document.getElementById("thanks-error");
    const menuToggle = document.getElementById("site-menu-toggle");
    const musicCredit = document.getElementById("thanks-music-credit");
    const statsLink = document.getElementById("thanks-stats-link");
    const messageArea = document.getElementById("thanks-message-area");
    const afterVideo = document.getElementById("thanks-after-video");
    let started = false;
    let creditShown = false;
    let lastPosition = 0;
    let correctingSeek = false;
    let changingSource = false;
    let sourceRequest = 0;
    let startRequest = 0;

    function showStatsButton() {
      if (firstVisit || !statsLink.hidden) return;
      statsLink.hidden = false;
      void statsLink.offsetWidth;
      root.classList.add("thanks-stats-ready");
    }

    function fitPlayer() {
      const height = afterVideo.getBoundingClientRect().height;
      root.style.setProperty("--thanks-footer-space", height
        ? `calc(${height}px + var(--thanks-credit-gap) + max(12px, env(safe-area-inset-bottom, 0px)))`
        : "0px");
    }

    function setNotice(message = "") {
      status.textContent = message;
      root.classList.toggle("thanks-notice-active", Boolean(message));
      musicCredit.setAttribute("aria-hidden", String(Boolean(message) || musicCredit.hidden));
      messageArea.hidden = !message && musicCredit.hidden;
      showStatsButton();
      fitPlayer();
    }

    function showPlayButton() {
      playButton.textContent = "PLAY";
      playButton.setAttribute("aria-label", started ? "Resume Jeff's movie" : "Play Jeff's movie");
      playButton.disabled = false;
      playButton.hidden = false;
    }

    function revealPlayer() {
      void playButton.offsetWidth;
      player.classList.add("is-visible");
    }

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
      setNotice();
      applyControls();
      setMenuLocked(false);
    }

    function showError() {
      startRequest++;
      changingSource = false;
      error.hidden = false;
      playButton.hidden = true;
      setNotice();
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
          showPlayButton();
          setNotice("Tap Play to start or resume Jeff's movie.");
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
      playButton.hidden = started;
      setNotice("Loading Jeff's movie…");
      video.src = source;

      video.addEventListener("loadedmetadata", () => {
        if (request !== sourceRequest) return;
        const position = Number.isFinite(video.duration)
          ? Math.min(resumeAt, Math.max(0, video.duration - 0.1)) : resumeAt;
        const restored = () => {
          if (request !== sourceRequest) return;
          changingSource = false;
          lastPosition = position;
          if (!resumePlayback) setNotice();
          if (resumePlayback) void play();
          else if (!started || firstVisit) showPlayButton();
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
      root.classList.add("thanks-has-played");
      video.removeAttribute("aria-hidden");
      playButton.hidden = true;
      playButton.disabled = false;
      setNotice();
      if (firstVisit) setMenuLocked(true);
      if (!creditShown) {
        creditShown = true;
        musicCredit.hidden = false;
        messageArea.hidden = false;
        musicCredit.setAttribute("aria-hidden", "false");
        musicCredit.classList.add("is-showing");
        fitPlayer();
      }
    });

    musicCredit.addEventListener("animationend", event => {
      if (event.target !== musicCredit || event.animationName !== "thanks-music-credit") return;
      musicCredit.hidden = true;
      musicCredit.setAttribute("aria-hidden", "true");
      setNotice(status.textContent);
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
      showPlayButton();
    });
    video.addEventListener("waiting", () => {
      if (error.hidden) setNotice("Buffering Jeff's movie…");
    });
    video.addEventListener("canplay", () => {
      if (!changingSource && error.hidden) setNotice();
    });
    video.addEventListener("error", showError);
    video.addEventListener("ended", () => {
      if (!changingSource && !correctingSeek) {
        finishFirstView();
        showStatsButton();
      }
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

    if (window.ResizeObserver) new ResizeObserver(fitPlayer).observe(afterVideo);
    window.addEventListener("resize", fitPlayer);
    document.fonts?.ready.then(fitPlayer);

    applyControls();
    loadVideo();
    root.classList.remove("thanks-pending");
    if (!firstVisit) {
      root.classList.add("thanks-dark");
      revealPlayer();
      return;
    }

    // Paint the tan starting color before beginning the fade to black.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add("thanks-dark");
      const duration = parseFloat(getComputedStyle(document.body).transitionDuration) * 1000;
      window.setTimeout(revealPlayer, duration + 50);
    }));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else initialize();
})();