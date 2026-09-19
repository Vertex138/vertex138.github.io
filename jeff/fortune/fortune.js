(() => {
  "use strict";

  const FORTUNE_UNLOCK_REQUIREMENT = 80;
  const TOTAL_IMAGE_GOAL = 150;
  const ROOT_PAGE = "/jeff/";
  const STORAGE_KEYS = {
    viewed: "viewedImages",
    intro: "fortuneIntroViewed",
    cooldown: "fortuneCooldownUntil",
    fortunes: "fortuneState",
  };
  const root = document.documentElement;

  function redirectIfFortuneIsLocked() {
    let viewedCount = 0;

    try {
      const storedIds = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.viewed) || "[]",
      );
      if (Array.isArray(storedIds)) {
        viewedCount = new Set(
          storedIds
            .filter((id) => typeof id === "number" || typeof id === "string")
            .map(Number)
            .filter(
              (id) => Number.isInteger(id) && id >= 1 && id <= TOTAL_IMAGE_GOAL,
            ),
        ).size;
      }
    } catch (error) {
      console.warn("Could not check Fortune unlock progress:", error);
    }

    if (viewedCount >= FORTUNE_UNLOCK_REQUIREMENT) {
      return false;
    }

    root.style.display = "none";
    window.location.replace(ROOT_PAGE);
    return true;
  }

  // Run before accessing page elements or requesting artwork.
  if (redirectIfFortuneIsLocked()) {
    return;
  }

  try {
    if (localStorage.getItem(STORAGE_KEYS.intro) === "true") {
      root.classList.add("fortune-revisit");
    }
  } catch (error) {
    // Use the first-visit presentation if this preference cannot be read.
  }
  root.style.display = "";

  // Recheck when the browser restores this page from its back/forward cache.
  window.addEventListener("pageshow", redirectIfFortuneIsLocked);

  function startFortunePage() {
    if (redirectIfFortuneIsLocked()) {
      return;
    }

    const COOLDOWN_MS = 6 * 60 * 60 * 1000;
    const RECENT_FORTUNE_LIMIT = 40;
    const FORTUNE_DIRECTORY = "/jeff/fortune/fortunes/";
    const FORTUNE_LIST_SOURCE = "/jeff/fortune/fortunes.json";
    const LAYER_NAMES = [
      "bg",
      "peek1",
      "peek2",
      "peek3",
      "peek4",
      "jeff",
      "blink",
      "out",
      "fg",
      "text1",
      "text2",
    ];
    const TEXT_LAYERS = ["text1", "text2"];
    const OTHER_LAYERS = LAYER_NAMES.filter(
      (name) => !TEXT_LAYERS.includes(name),
    );

    const page = document.getElementById("fortune-page");
    const scene = document.getElementById("fortune-scene");
    const character = document.getElementById("fortune-character-group");
    const stars = document.getElementById("fortune-stars");
    const loadingMessage = document.getElementById("fortune-loading");
    const errorPanel = document.getElementById("fortune-error");
    const retryButton = document.getElementById("fortune-retry-button");
    const actionButton = document.getElementById("fortune-action-button");
    const cooldownPanel = document.getElementById("fortune-cooldown");
    const countdown = document.getElementById("fortune-countdown");
    const timer = document.getElementById("fortune-timer");
    const lastFortuneButton = document.getElementById("fortune-last-button");
    const fortuneOverlay = document.getElementById("fortune-card-overlay");
    const viewerControls = document.getElementById("fortune-viewer-controls");
    const saveFortuneButton = document.getElementById("fortune-save-button");
    const closeFortuneButton = document.getElementById("fortune-close-button");
    const fortuneButton = document.getElementById("fortune-card-button");
    const fortuneCard = document.getElementById("fortune-card");
    const layers = Object.fromEntries(
      [...document.querySelectorAll("[data-layer]")].map((layer) => [
        layer.dataset.layer,
        layer,
      ]),
    );

    const layerLoads = new Map();
    let referenceSize = null;
    let phase = "loading";
    let actionHandler = null;
    let ambientLoop = null;
    let cooldownInterval = null;
    let blinkVersion = 0;
    let exitAnimation = Promise.resolve();
    let displayedFortune = null;
    let fortuneFiles = [];

    function reducedMotionEnabled() {
      return (
        window.JeffSite?.reducedMotionEnabled?.() ??
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    }

    function randomBetween(minimum, maximum) {
      return minimum + Math.random() * (maximum - minimum);
    }

    function wait(milliseconds) {
      return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    function readStorage(key) {
      try {
        return localStorage.getItem(key);
      } catch (error) {
        console.warn(`Could not read "${key}" from localStorage:`, error);
        return null;
      }
    }

    function writeStorage(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch (error) {
        console.warn(`Could not save "${key}" to localStorage:`, error);
      }
    }

    function removeStorage(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn(`Could not remove "${key}" from localStorage:`, error);
      }
    }

    function introWasViewed() {
      return readStorage(STORAGE_KEYS.intro) === "true";
    }

    function isFortuneFile(filename) {
      return typeof filename === "string" && fortuneFiles.includes(filename);
    }

    async function loadFortuneList() {
      const response = await fetch(FORTUNE_LIST_SOURCE);
      if (!response.ok) {
        throw new Error(`Could not load fortunes.json: ${response.status}`);
      }
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(
          "fortunes.json must map numeric IDs to image filenames.",
        );
      }
      const entries = Object.entries(data);
      if (
        !entries.length ||
        entries.some(
          ([id, filename]) =>
            !Number.isInteger(Number(id)) ||
            Number(id) < 0 ||
            typeof filename !== "string" ||
            /[/\\]/.test(filename) ||
            !/\.(png|jpe?g|webp|gif|avif)$/i.test(filename),
        )
      ) {
        throw new Error(
          "fortunes.json contains a missing or invalid image filename.",
        );
      }
      fortuneFiles = [
        ...new Set(
          entries
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([, filename]) => filename),
        ),
      ];
    }

    function readFortuneState() {
      let saved;
      try {
        saved = JSON.parse(readStorage(STORAGE_KEYS.fortunes) || "null");
      } catch (error) {
        console.warn("Could not read saved fortunes:", error);
      }
      const last = isFortuneFile(saved?.last) ? saved.last : null;
      let recent = Array.isArray(saved?.recent)
        ? [...new Set(saved.recent.filter(isFortuneFile))]
        : [];
      if (last !== null) {
        recent = recent.filter((filename) => filename !== last).concat(last);
      }
      return {
        last,
        recent: recent.slice(-RECENT_FORTUNE_LIMIT),
        cooldownUntil: Number.isFinite(saved?.cooldownUntil)
          ? saved.cooldownUntil
          : 0,
      };
    }

    function activeCooldownDeadline(state = readFortuneState()) {
      // Honor timers started by the earlier version of this page, too.
      const legacyDeadline = Number(readStorage(STORAGE_KEYS.cooldown)) || 0;
      const deadline = Math.max(state.cooldownUntil, legacyDeadline);
      return Number.isFinite(deadline) && deadline > Date.now() ? deadline : 0;
    }

    function claimFortune() {
      const state = readFortuneState();
      if (activeCooldownDeadline(state)) {
        return null;
      }
      if (!fortuneFiles.length) {
        throw new Error("No fortunes are available in fortunes.json.");
      }
      // Leave a choice available while testing with fewer than 41 images.
      const excludedCount = Math.min(
        RECENT_FORTUNE_LIMIT,
        fortuneFiles.length - 1,
      );
      const excluded = excludedCount ? state.recent.slice(-excludedCount) : [];
      const available = fortuneFiles.filter(
        (filename) => !excluded.includes(filename),
      );
      const filename = available[Math.floor(Math.random() * available.length)];
      const next = {
        last: filename,
        recent: [
          ...state.recent.filter((item) => item !== filename),
          filename,
        ].slice(-RECENT_FORTUNE_LIMIT),
        cooldownUntil: Date.now() + COOLDOWN_MS,
      };

      // Save all three together, before any animation or image request.
      // If storage fails, do not reveal an unrecorded fortune.
      localStorage.setItem(STORAGE_KEYS.fortunes, JSON.stringify(next));
      return next;
    }

    function fortuneSource(filename) {
      return FORTUNE_DIRECTORY + encodeURIComponent(filename);
    }

    function fortuneDownloadName(filename, date = new Date()) {
      const timestamp = [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
      ]
        .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
        .join("");
      const extension = filename.split(".").pop().toLowerCase();
      return `JeffFortune-${timestamp}.${extension}`;
    }

    function setSceneDimensions(image) {
      const size = `${image.naturalWidth}x${image.naturalHeight}`;

      if (!referenceSize) {
        referenceSize = size;
        root.style.setProperty(
          "--fortune-aspect",
          image.naturalWidth / image.naturalHeight,
        );
        scene.dataset.width = String(image.naturalWidth);
        scene.dataset.height = String(image.naturalHeight);
        resizeScene();
      } else if (referenceSize !== size) {
        console.warn(
          `${image.src} is ${size}; Fortune layers are expected to match ${referenceSize}.`,
        );
      }
    }

    function resizeScene() {
      const naturalWidth = Number(scene.dataset.width);
      const naturalHeight = Number(scene.dataset.height);

      if (!(naturalWidth > 0 && naturalHeight > 0)) {
        return;
      }

      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight =
        window.visualViewport?.height || window.innerHeight;
      const ratio = naturalWidth / naturalHeight;
      const controlsHeight = document
        .getElementById("fortune-controls")
        .getBoundingClientRect().height;
      const height = Math.max(
        0,
        Math.min(
          viewportHeight * 0.8,
          viewportHeight - controlsHeight,
          viewportWidth / ratio,
        ),
      );

      scene.style.width = `${height * ratio}px`;
      scene.style.height = `${height}px`;
    }

    function loadLayer(name) {
      if (layerLoads.has(name)) {
        return layerLoads.get(name);
      }

      const layer = layers[name];
      const promise = new Promise((resolve, reject) => {
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          setSceneDimensions(layer);
          layer.classList.add("is-loaded");
          resolve(layer);
        };

        const fail = () => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new Error(`Could not load ${layer.dataset.src}.`));
        };

        layer.addEventListener("load", finish, { once: true });
        layer.addEventListener("error", fail, { once: true });
        layer.src = layer.dataset.src;

        if (layer.complete && layer.naturalWidth > 0) {
          queueMicrotask(finish);
        }
      });

      layerLoads.set(name, promise);
      return promise;
    }

    function loadLayers(names) {
      return Promise.all(names.map(loadLayer));
    }

    function setLayerOpacity(name, opacity) {
      const layer = layers[name];
      layer.classList.toggle("is-loaded", opacity > 0 || layer.complete);
      layer.style.opacity = String(opacity);
      if (opacity === 0) {
        layer.style.visibility = "hidden";
      } else {
        layer.style.visibility = "visible";
      }
    }

    async function fadeLayer(name, opacity, duration) {
      const layer = await loadLayer(name);
      const startingOpacity =
        Number.parseFloat(getComputedStyle(layer).opacity) || 0;
      layer.classList.add("is-loaded");
      layer.style.visibility = "visible";

      if (duration <= 0 || startingOpacity === opacity) {
        setLayerOpacity(name, opacity);
        return;
      }

      const animation = layer.animate(
        [{ opacity: startingOpacity }, { opacity }],
        { duration, easing: "linear" },
      );

      try {
        await animation.finished;
      } catch (error) {
        if (animation.playState === "idle") {
          return;
        }
        throw error;
      }
      setLayerOpacity(name, opacity);
      animation.cancel();
    }

    async function moveElement(
      element,
      from,
      to,
      duration,
      easing = "ease-in-out",
    ) {
      element.style.transform = from;

      if (duration <= 0) {
        element.style.transform = to;
        return;
      }

      const animation = element.animate(
        [{ transform: from }, { transform: to }],
        { duration, easing },
      );
      await animation.finished;
      element.style.transform = to;
      animation.cancel();
    }

    function startAmbientLoop(task, minDelay = 3000, maxDelay = 10000) {
      const state = {
        stopping: false,
        wake: null,
        promise: null,
      };

      state.promise = (async () => {
        while (!state.stopping) {
          await new Promise((resolve) => {
            const timer = window.setTimeout(
              resolve,
              randomBetween(minDelay, maxDelay),
            );
            state.wake = () => {
              window.clearTimeout(timer);
              resolve();
            };
          });
          state.wake = null;

          if (!state.stopping) {
            await task();
          }
        }
      })();

      ambientLoop = state;
    }

    async function stopAmbientLoop() {
      const state = ambientLoop;
      ambientLoop = null;

      if (!state) {
        return;
      }

      state.stopping = true;
      state.wake?.();
      await state.promise;
    }

    function showAction(label, handler) {
      actionHandler = handler;
      actionButton.textContent = label;
      actionButton.disabled = false;
      actionButton.hidden = false;
    }

    function hideAction() {
      actionHandler = null;
      actionButton.disabled = true;
      actionButton.hidden = true;
    }

    async function blinkOnce() {
      const version = blinkVersion;
      await fadeLayer("blink", 1, 100);
      if (version !== blinkVersion) {
        return;
      }
      await wait(200);
      if (version !== blinkVersion) {
        return;
      }
      await fadeLayer("blink", 0, 100);
    }

    function cancelBlink() {
      blinkVersion += 1;
      layers.blink.getAnimations().forEach((animation) => animation.cancel());
      setLayerOpacity("blink", 0);
    }

    async function blinkTwice() {
      await blinkOnce();
      await wait(250);
      await blinkOnce();
    }

    async function playPeek() {
      const number = Math.floor(Math.random() * 4) + 1;
      const name = `peek${number}`;

      if (reducedMotionEnabled()) {
        layers[name].style.transform = "translateX(0)";
        await fadeLayer(name, 1, 350);
        await wait(1000);
        await fadeLayer(name, 0, 350);
        return;
      }

      const offset = number <= 2 ? "translateX(-50vw)" : "translateX(50vw)";
      await loadLayer(name);
      setLayerOpacity(name, 1);
      await moveElement(layers[name], offset, "translateX(0)", 1000);
      await wait(1500);
      await moveElement(layers[name], "translateX(0)", offset, 1000);
      setLayerOpacity(name, 0);
    }

    function walkingFrames(start, finish) {
      return Array.from({ length: 41 }, (_, index) => {
        const progress = index / 40;
        const horizontal = start + (finish - start) * progress;
        const bounce =
          progress === 1 ? 0 : -Math.abs(Math.sin(progress * Math.PI * 10)) * 8;
        return {
          offset: progress,
          transform: `translate3d(${horizontal}vw, ${bounce}px, 0)`,
        };
      });
    }

    async function walkJeff(start, finish) {
      const animation = character.animate(walkingFrames(start, finish), {
        duration: 3000,
        easing: "linear",
      });
      await animation.finished;
      character.style.transform = `translate3d(${finish}vw, 0, 0)`;
      animation.cancel();
    }

    async function summonJeff() {
      phase = "summoning";
      setLayerOpacity("blink", 0);

      if (reducedMotionEnabled()) {
        character.style.transform = "translate3d(0, 0, 0)";
        await fadeLayer("jeff", 1, 1500);
      } else {
        await loadLayer("jeff");
        setLayerOpacity("jeff", 1);
        character.style.transform = "translate3d(-70vw, 0, 0)";
        await walkJeff(-70, 0);
      }

      await wait(800);
      await blinkTwice();
      beginFortuneRequest();
    }

    async function beginSummon() {
      phase = "summon-ready";
      showAction("Summon Jeff", async () => {
        hideAction();
        await stopAmbientLoop();
        await summonJeff();
      });
      startAmbientLoop(playPeek, 2000, 5000);
    }

    function createStar(stationary = false) {
      const star = document.createElement("span");
      star.className = `fortune-star ${stationary ? "is-stationary" : "is-swirling"}`;
      star.textContent = "★";
      star.style.left = `${randomBetween(34, 66)}%`;
      star.style.top = `${randomBetween(55, 88)}%`;
      star.style.setProperty(
        "--star-color",
        Math.random() < 0.5 ? "var(--fortune-gold)" : "var(--fortune-purple)",
      );
      star.style.setProperty("--star-size", `${randomBetween(10, 24)}px`);
      star.style.setProperty("--star-x", `${randomBetween(-45, 45)}px`);
      star.style.setProperty("--star-y", `${randomBetween(-70, -20)}px`);
      star.style.setProperty(
        "--star-rotation",
        `${randomBetween(-180, 180)}deg`,
      );
      star.style.setProperty("--star-duration", `${randomBetween(1.2, 2.4)}s`);
      stars.append(star);

      if (!stationary) {
        star.addEventListener("animationend", () => star.remove(), {
          once: true,
        });
      }
      return star;
    }

    function shakeCharacter(duration) {
      return new Promise((resolve) => {
        const started = performance.now();

        function frame(now) {
          const elapsed = now - started;
          const progress = Math.min(elapsed / duration, 1);
          const amplitude = 0.4 + progress * 3;
          const x = Math.sin(elapsed * 0.065) * amplitude;
          const y = Math.cos(elapsed * 0.083) * amplitude * 0.45;
          character.style.transform = `translate3d(${x}px, ${y}px, 0)`;

          if (progress < 1) {
            requestAnimationFrame(frame);
          } else {
            character.style.transform = "translate3d(0, 0, 0)";
            resolve();
          }
        }

        requestAnimationFrame(frame);
      });
    }

    async function swirlingStars(duration) {
      const started = performance.now();

      while (performance.now() - started < duration) {
        const progress = Math.min((performance.now() - started) / duration, 1);
        createStar();
        await wait(420 - progress * 300);
      }

      await wait(1800);
    }

    async function stationaryStars(duration) {
      const started = performance.now();
      const created = [];

      for (let index = 0; index < 14; index += 1) {
        const star = createStar(true);
        created.push(star);
        const fadeIn = star.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 100,
          easing: "linear",
          fill: "forwards",
        });
        await fadeIn.finished;
        star.style.opacity = "1";
        fadeIn.cancel();
      }

      await wait(Math.max(0, duration - (performance.now() - started)));
      const fadeOut = stars.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 500,
        easing: "linear",
        fill: "forwards",
      });
      await fadeOut.finished;
      created.forEach((star) => star.remove());
      fadeOut.cancel();
    }

    async function performFortuneRitual() {
      phase = "conjuring";
      await fadeLayer("blink", 1, 250);
      await wait(1000);

      const duration = randomBetween(3000, 5000);
      if (reducedMotionEnabled()) {
        await stationaryStars(duration);
      } else {
        await Promise.all([shakeCharacter(duration), swirlingStars(duration)]);
      }

      await fadeLayer("blink", 0, 100);
      beginTakeFortune();
    }

    function beginFortuneRequest() {
      phase = "fortune-ready";
      showAction("Ask for a fortune", async () => {
        hideAction();
        await stopAmbientLoop();
        await performFortuneRitual();
      });
      startAmbientLoop(blinkOnce);
    }

    function loadFortuneCard(filename) {
      const source = fortuneSource(filename);
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          fortuneCard.removeEventListener("load", loaded);
          fortuneCard.removeEventListener("error", failed);
          error ? reject(error) : resolve();
        };
        const loaded = () => finish();
        const failed = () => finish(new Error(`Could not load ${source}.`));
        fortuneCard.addEventListener("load", loaded);
        fortuneCard.addEventListener("error", failed);
        fortuneCard.src = source;
        if (fortuneCard.complete && fortuneCard.naturalWidth > 0) {
          queueMicrotask(loaded);
        }
      });
    }

    async function revealFortuneCard(filename) {
      await loadFortuneCard(filename);
      fortuneOverlay.hidden = false;
      fortuneButton.hidden = false;
      fortuneButton.disabled = true;

      if (reducedMotionEnabled()) {
        fortuneButton.style.transform = "translateY(0)";
        const animation = fortuneButton.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          {
            duration: 500,
            easing: "linear",
          },
        );
        await animation.finished;
        fortuneButton.style.opacity = "1";
        animation.cancel();
      } else {
        fortuneButton.style.opacity = "1";
        await moveElement(
          fortuneButton,
          "translateY(110dvh)",
          "translateY(0)",
          900,
          "cubic-bezier(0.2, 0.75, 0.25, 1)",
        );
      }

      fortuneButton.disabled = false;
    }

    async function dismissFortuneCard() {
      if (reducedMotionEnabled()) {
        const animation = fortuneButton.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          {
            duration: 500,
            easing: "linear",
          },
        );
        await animation.finished;
        fortuneButton.style.opacity = "0";
        animation.cancel();
      } else {
        await moveElement(
          fortuneButton,
          "translateY(0)",
          "translateY(110dvh)",
          700,
          "ease-in",
        );
      }
      fortuneButton.hidden = true;
      fortuneOverlay.hidden = true;
    }

    async function viewFortune(filename) {
      phase = "revealing";
      window.clearInterval(cooldownInterval);
      cooldownPanel.hidden = true;
      viewerControls.hidden = true;
      await revealFortuneCard(filename);
      displayedFortune = filename;
      saveFortuneButton.href = fortuneSource(filename);
      saveFortuneButton.download = fortuneDownloadName(filename);
      viewerControls.hidden = false;
      phase = "viewing";
      closeFortuneButton.focus({ preventScroll: true });
    }

    async function closeFortune() {
      if (phase !== "viewing") return;
      phase = "dismissing";
      viewerControls.hidden = true;
      fortuneButton.disabled = true;
      await dismissFortuneCard();
      await exitAnimation;
      showCooldown(activeCooldownDeadline());
      if (!lastFortuneButton.hidden) {
        lastFortuneButton.focus({ preventScroll: true });
      }
    }

    async function viewLastFortune() {
      if (phase !== "cooldown") return;
      const { last } = readFortuneState();
      if (last) await viewFortune(last);
    }

    async function sendJeffAway() {
      await fadeLayer("out", 1, 100);

      if (reducedMotionEnabled()) {
        await fadeLayer("jeff", 0, 1500);
      } else {
        await walkJeff(0, 70);
        setLayerOpacity("jeff", 0);
      }
    }

    function formatTime(milliseconds) {
      const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainder = seconds % 60;
      return [hours, minutes, remainder]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
    }

    function showCooldown(deadline) {
      phase = "cooldown";
      hideAction();
      cooldownPanel.hidden = false;
      lastFortuneButton.hidden = !readFortuneState().last;
      window.clearInterval(cooldownInterval);

      const update = () => {
        const remaining = deadline - Date.now();

        if (remaining <= 0) {
          window.clearInterval(cooldownInterval);
          removeStorage(STORAGE_KEYS.cooldown);
          window.location.reload();
          return false;
        }

        countdown.textContent = formatTime(remaining);
        timer.setAttribute(
          "aria-label",
          `Return for another fortune later. ${countdown.textContent} remaining.`,
        );
        return true;
      };

      if (update()) {
        cooldownInterval = window.setInterval(update, 1000);
      }
    }

    async function takeFortune() {
      const fortune = claimFortune();
      phase = "revealing";
      hideAction();
      const stoppedBlinking = stopAmbientLoop();
      cancelBlink();
      await stoppedBlinking;
      setLayerOpacity("blink", 0);

      if (!fortune) {
        // Another tab may have acquired a fortune since this page opened.
        setLayerOpacity("jeff", 0);
        setLayerOpacity("out", 1);
        showCooldown(activeCooldownDeadline());
        return;
      }

      await viewFortune(fortune.last);
      exitAnimation = sendJeffAway().catch(showError);
    }

    function beginTakeFortune() {
      phase = "take-ready";
      showAction("Take Fortune", takeFortune);
      startAmbientLoop(blinkOnce);
    }

    async function playFirstVisit() {
      await Promise.all([wait(1000), loadLayers(LAYER_NAMES)]);

      root.classList.add("fortune-background-transition");
      void document.body.offsetWidth;
      root.classList.add("fortune-dark");
      await wait(1000);
      loadingMessage.hidden = true;

      await wait(500);
      await fadeLayer("text1", 1, 1000);
      await wait(1500);
      await fadeLayer("text2", 1, 1000);
      await wait(2000);
      await fadeLayer("bg", 1, 2500);
      setLayerOpacity("fg", 1);
      await wait(1500);

      writeStorage(STORAGE_KEYS.intro, true);
      root.classList.add("fortune-revisit");
      await beginSummon();
    }

    async function playRevisit() {
      root.classList.add("fortune-dark", "fortune-revisit");

      const textPromises = TEXT_LAYERS.map((name) =>
        loadLayer(name).then(() => setLayerOpacity(name, 1)),
      );
      await Promise.all(textPromises);
      await loadLayers(OTHER_LAYERS);
      loadingMessage.hidden = true;

      await fadeLayer("bg", 1, 1000);
      setLayerOpacity("fg", 1);

      const deadline = activeCooldownDeadline();
      if (deadline) {
        showCooldown(deadline);
        await fadeLayer("out", 1, 500);
      } else {
        removeStorage(STORAGE_KEYS.cooldown);
        await beginSummon();
      }
    }

    function showError(error) {
      console.error(error);
      phase = "error";
      stopAmbientLoop();
      window.clearInterval(cooldownInterval);
      fortuneOverlay.hidden = true;
      fortuneButton.hidden = true;
      viewerControls.hidden = true;
      cooldownPanel.hidden = true;
      loadingMessage.hidden = true;
      hideAction();
      errorPanel.hidden = false;
      page.setAttribute("aria-busy", "false");
    }

    async function initialize() {
      try {
        errorPanel.hidden = true;
        page.setAttribute("aria-busy", "true");
        await loadFortuneList();

        if (introWasViewed() || activeCooldownDeadline()) {
          await playRevisit();
        } else {
          await playFirstVisit();
        }

        page.setAttribute("aria-busy", "false");
      } catch (error) {
        showError(error);
      }
    }

    actionButton.addEventListener("click", async () => {
      if (!actionHandler || actionButton.disabled) {
        return;
      }

      const handler = actionHandler;
      actionButton.disabled = true;
      actionHandler = null;

      try {
        await handler();
      } catch (error) {
        showError(error);
      }
    });

    retryButton.addEventListener("click", () => window.location.reload());
    fortuneButton.addEventListener("click", () =>
      closeFortune().catch(showError),
    );
    closeFortuneButton.addEventListener("click", () =>
      closeFortune().catch(showError),
    );
    lastFortuneButton.addEventListener("click", () =>
      viewLastFortune().catch(showError),
    );
    saveFortuneButton.addEventListener("click", (event) => {
      if (phase !== "viewing" || !displayedFortune) {
        event.preventDefault();
        return;
      }
      saveFortuneButton.download = fortuneDownloadName(displayedFortune);
    });
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        phase === "viewing" &&
        !root.classList.contains("site-menu-open") &&
        document.getElementById("accessibility-overlay")?.hidden !== false
      ) {
        closeFortune().catch(showError);
      }
    });
    document.addEventListener("jeff:history-cleared", () => {
      if (!redirectIfFortuneIsLocked()) {
        window.location.reload();
      }
    });
    window.addEventListener("resize", resizeScene);
    window.visualViewport?.addEventListener("resize", resizeScene);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && !redirectIfFortuneIsLocked()) {
        window.location.reload();
      }
    });

    window.addEventListener("pagehide", () => {
      window.clearInterval(cooldownInterval);
      ambientLoop && (ambientLoop.stopping = true);
    });

    initialize();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startFortunePage, {
      once: true,
    });
  } else {
    startFortunePage();
  }
})();
