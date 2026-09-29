(() => {
  "use strict";

  const CONFIG = Object.freeze({
    endpoint: "https://script.google.com/macros/s/AKfycbxj-7Y1rB-AeS_DXykTOjMyTrVnGXRhb7z1IugMR9wLXWgkJRCUgXOmo9dkDfd_zgAc8w/exec",
    siteOrigins: Object.freeze([
      "https://vertex138.github.io",
      "https://www.colinbrinkley.com", "http://www.colinbrinkley.com",
      "https://colinbrinkley.com", "http://colinbrinkley.com",
      "https://www.vertex138.com", "http://www.vertex138.com",
      "https://vertex138.com", "http://vertex138.com",
    ]),
    root: "/jeff/",
    unlock: 100,
    storage: "jeffMailbox",
    messageLimit: 1000,
    signatureLimit: 100,
    timeout: 45000,
  });
  const IMAGES = Object.freeze({
    total: 150,
    recentLimit: 10,
    map: "/jeff/images.json",
    thumbsMap: "/jeff/thumbs.json",
    directory: "/jeff/images/",
    thumbsDirectory: "/jeff/thumbs/",
  });
  const FORTUNES = Object.freeze({
    count: 100,
    map: "/jeff/fortune/fortunes.json",
    directory: "/jeff/fortune/fortunes/",
  });
  const IMAGE_STORAGE = Object.freeze({
    viewed: "viewedImages",
    recent: "recentImages",
    streak: "noNewImageStreak",
    completion: "collectionCompleteAcknowledged",
  });
  const RECIPIENTS = {
    jeff: "Jeff", jefferson: "Mr. Jefferson", caretaker: "Jeff's Caretaker",
    secretary: "Jeff's Secretary", publicist: "Jeff's Publicist", admin: "Jeff's Website Admin",
  };
  const HEX_ID = /^[a-f0-9]{32}$/;
  const HEX_KEY = /^[a-f0-9]{64}$/;
  const root = document.documentElement;
  const letters = new Map();
  let ui, state, mailboxKey, busy = false, ready = false, storageReady = true, connectionFailed = false;
  let quotaUntil = 0, nextCursor = null, dayTimer, draftTimer, escapeTimer, lastRefresh = 0;
  let escapePresses = 0;
  let imageMapsPromise = null, fortuneMapPromise = null, imageViewerState = "closed", imageViewerRequest = 0;
  let imageViewerTrigger = null, newIndicatorTimer = null, newIndicatorHideTimer = null, modalFocus = null;

  function hasAccess() {
    try {
      const ids = JSON.parse(localStorage.getItem("viewedImages") || "[]");
      const required = window.JeffSite?.getUnlockRequirement("Jeff's Mailbox") ?? CONFIG.unlock;
      return Array.isArray(ids) && new Set(ids.map(Number).filter(id =>
        Number.isInteger(id) && id >= 1 && id <= 150)).size >= required;
    } catch (_) { return false; }
  }
  function checkAccess() {
    if (hasAccess()) return true;
    root.classList.add("mailbox-pending");
    location.replace(CONFIG.root);
    return false;
  }
  if (!checkAccess()) return;
  document.addEventListener("DOMContentLoaded", initialize, { once: true });

  function problem(code, message) { return Object.assign(new Error(message), { code }); }
  function randomHex(bytes) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2, "0")).join("");
  }
  function withLock(callback) {
    return navigator.locks ? navigator.locks.request("jeff-mailbox-write", callback) : Promise.resolve().then(callback);
  }
  function normalize(value) { return value.replace(/\r\n?/g, "\n").normalize("NFC"); }
  function dateKey(value = new Date()) {
    const date = new Date(value);
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("-");
  }
  function validDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
  function laterDate(a, b) { return !validDate(a) || Date.parse(b) > Date.parse(a) ? b : a; }
  function sentToday() { return state?.lastReceivedAt && dateKey(state.lastReceivedAt) >= dateKey(); }
  function emptyDraft() { return { to: ["jeff"], message: "", signature: "" }; }

  function readState(create = false) {
    try {
      const raw = localStorage.getItem(CONFIG.storage);
      if (!raw && create) return {
        version: 1, key: randomHex(32), lastReceivedAt: null,
        pending: null, draft: emptyDraft(), replyStatus: {}
      };
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !HEX_KEY.test(saved.key) || (mailboxKey && saved.key !== mailboxKey)) {
        throw new Error("Mailbox identity changed");
      }
      if (saved.lastReceivedAt !== null && !validDate(saved.lastReceivedAt)) throw new Error("Invalid receipt");
      if (saved.pending) validateLetter(saved.pending, true);
      const draft = saved.draft || emptyDraft();
      if (!Array.isArray(draft.to) || draft.to.some(id => typeof id !== "string") ||
          typeof draft.message !== "string" || typeof draft.signature !== "string") throw new Error("Invalid draft");
      saved.draft = { ...draft, to: [draft.to.find(id => Object.hasOwn(RECIPIENTS, id)) || "jeff"] };
      const replyStatus = saved.replyStatus && typeof saved.replyStatus === "object" && !Array.isArray(saved.replyStatus)
        ? saved.replyStatus : {};
      saved.replyStatus = Object.fromEntries(Object.entries(replyStatus).filter(([id, status]) =>
        HEX_ID.test(id) && status && typeof status === "object" && validDate(status.receivedAt) && typeof status.read === "boolean"));
      return saved;
    } catch (_) {
      throw problem("STORAGE", "Your saved mailbox could not be opened. Reload this page in the browser you used before. Browser storage must be enabled.");
    }
  }
  function writeState(saved) {
    state = saved;
    try {
      const value = JSON.stringify(saved);
      localStorage.setItem(CONFIG.storage, value);
      if (localStorage.getItem(CONFIG.storage) !== value) throw new Error("Storage unavailable");
    } catch (_) {
      throw problem("STORAGE", "This browser could not save your mailbox. Please enable browser storage and reload before sending a letter.");
    }
  }
  function changeState(change) {
    const saved = readState();
    change(saved);
    writeState(saved);
  }
  function markAccepted(id, receivedAt) {
    changeState(saved => {
      saved.lastReceivedAt = laterDate(saved.lastReceivedAt, receivedAt);
      if (saved.pending?.messageId === id) { saved.pending = null; saved.draft = emptyDraft(); }
    });
  }

  function handleDebugReset(event) {
    if (event.key !== "Escape" || event.repeat) return;
    clearTimeout(escapeTimer);
    escapePresses += 1;
    escapeTimer = setTimeout(() => { escapePresses = 0; }, 1200);
    if (escapePresses < 3) return;
    clearTimeout(escapeTimer);
    escapePresses = 0;
    try {
      changeState(saved => { saved.lastReceivedAt = null; });
      quotaUntil = 0;
      updateControls();
      setStatus(ui.sendStatus, "Debug: today's sending allowance has been reset.");
    } catch (error) { fatal(error); }
  }

  function setStatus(element, message, error = false) {
    element.textContent = message;
    element.dataset.error = String(error);
  }
  function fatal(error) {
    storageReady = false;
    ready = false;
    ui.problem.hidden = false;
    ui.problem.textContent = error.message;
    setStatus(ui.historyStatus, "Jeff's mailbox is unavailable right now.");
    ui.history.setAttribute("aria-busy", "false");
    updateControls();
  }
  function formDraft() {
    return {
      to: [ui.recipient.value],
      message: ui.message.value, signature: ui.signature.value,
    };
  }
  function restoreDraft(draft) {
    ui.recipient.value = draft.to.find(id => Object.hasOwn(RECIPIENTS, id)) || "jeff";
    ui.message.value = draft.message;
    ui.signature.value = draft.signature;
    updateCounters();
  }
  function updateCounters() {
    ui.messageCount.textContent = Array.from(normalize(ui.message.value)).length + " / 1,000 characters";
    ui.signatureCount.textContent = Array.from(normalize(ui.signature.value)).length + " / 100 characters";
    ui.message.placeholder = "Write a letter to " + RECIPIENTS[ui.recipient.value] + " here!";
  }
  function editDraft(event) {
    if (event.isComposing) return;
    for (const [input, limit] of [[ui.message, CONFIG.messageLimit], [ui.signature, CONFIG.signatureLimit]]) {
      const normalized = normalize(input.value);
      if (Array.from(normalized).length > limit) input.value = Array.from(normalized).slice(0, limit).join("");
      input.setCustomValidity("");
    }
    updateCounters();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => withLock(() => {
      if (!storageReady) return;
      const saved = readState();
      if (!saved.pending) { saved.draft = formDraft(); writeState(saved); }
    }).catch(fatal), 200);
  }
  function updateControls() {
    if (!ui) return;
    const pending = !!state?.pending;
    const limited = sentToday() || quotaUntil > Date.now();
    ui.fields.disabled = !storageReady || pending;
    ui.send.disabled = !storageReady || busy || !ready || (!pending && limited);
    ui.send.textContent = busy && pending ? "Sending…" : pending ? "Retry delivery" : "Send to Jeff";
    ui.older.disabled = !storageReady || busy;
    ui.older.hidden = !nextCursor;
    ui.mailboxTab.disabled = !storageReady || !ready;
    ui.mailboxTab.setAttribute("aria-disabled", String(ui.mailboxTab.disabled));
    ui.retryConnection.hidden = !storageReady || !connectionFailed;
    ui.form.setAttribute("aria-busy", String(busy));
    ui.limit.textContent = pending ? "Jeff's secretary saved this letter until delivery is confirmed." : connectionFailed ? "Jeff's mailbox couldn't connect. Try again." : !ready ? "Connecting to Jefferson's Mailbox..." :
      sentToday() ? "Jeff's mailbox is closed for today. Check back tomorrow!" :
      quotaUntil > Date.now() ? "Jeff will accept another letter after " + new Date(quotaUntil).toLocaleString() + "." :
      "One letter per day. Jeff insists.";
    clearTimeout(dayTimer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const wake = quotaUntil > Date.now() ? Math.min(midnight, quotaUntil) : midnight;
    dayTimer = setTimeout(updateControls, Math.max(100, wake - Date.now() + 50));
  }
  function validateLetter(letter, stored = false) {
    // Keep older pending deliveries intact until their receipt can be checked.
    if (!HEX_ID.test(letter.messageId) || !Array.isArray(letter.to) || !letter.to.length ||
        (!stored && letter.to.length !== 1) ||
        letter.to.some(id => !Object.hasOwn(RECIPIENTS, id) && !(stored && id === "legal"))) {
      throw problem("RECIPIENT", "Choose one recipient for your letter.");
    }
    for (const [field, limit] of [["message", CONFIG.messageLimit], ["signature", CONFIG.signatureLimit]]) {
      const value = letter[field];
      if (typeof value !== "string" || Array.from(value).length > limit || (field === "message" && !value.trim())) {
        throw problem(field, field === "message" ? "Write a letter of up to 1,000 characters." : "Keep your signature to 100 characters or fewer.");
      }
      if ((field === "signature" && /[\n\t]/.test(value)) ||
          /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(value) ||
          Array.from(value).some(c => c.codePointAt(0) >= 0xD800 && c.codePointAt(0) <= 0xDFFF)) {
        throw problem(field, "Please remove unsupported control characters from your " + field + ".");
      }
    }
    return letter;
  }

  function trustedOrigin(origin) {
    return /^https:\/\/(?:script\.google\.com|script\.googleusercontent\.com|[a-z0-9-]+-script\.googleusercontent\.com)$/.test(origin);
  }
  function request(action, data = {}) {
    const requestId = randomHex(16);
    const payload = { ...data, version: 1, action, requestId, mailboxKey, siteOrigin: location.origin };
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      const form = document.createElement("form");
      const input = document.createElement("input");
      frame.name = "jeff-mailbox-" + requestId;
      frame.title = "Mailbox connection";
      frame.hidden = form.hidden = true;
      frame.referrerPolicy = "no-referrer";
      form.action = CONFIG.endpoint;
      form.method = "POST";
      form.target = frame.name;
      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(payload);
      form.append(input);
      let timer;
      const finish = (error, result) => {
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        frame.remove(); form.remove();
        if (error) reject(error); else resolve(result);
      };
      const receive = event => {
        const result = event.data;
        // Google sends from a nested iframe; validate its origin AND the one-use request ID.
        if (!trustedOrigin(event.origin) || !result || result.source !== "jeff-mailbox" ||
            result.version !== 1 || result.requestId !== requestId || typeof result.ok !== "boolean") return;
        if (!result.ok) {
          const code = typeof result.error?.code === "string" ? result.error.code : "UNAVAILABLE";
          const error = problem(code, typeof result.error?.message === "string" ? result.error.message : "Jeff's mailbox is unavailable right now. Try again.");
          error.nextAvailableAt = result.error?.nextAvailableAt;
          finish(error);
        } else if (result.action === action) finish(null, result);
      };
      window.addEventListener("message", receive);
      timer = setTimeout(() => finish(problem("TIMEOUT", "Jeff's mailbox took too long to answer. Try again.")), CONFIG.timeout);
      try {
        document.body.append(frame, form);
        HTMLFormElement.prototype.submit.call(form);
      } catch (_) { finish(problem("UNAVAILABLE", "Jeff's mailbox door would not open. Try again.")); }
    });
  }
  function applyAllowance(result) {
    quotaUntil = result.remaining === 0 && validDate(result.nextAvailableAt) ? Date.parse(result.nextAvailableAt) : 0;
  }
  function validateList(result) {
    if (!Array.isArray(result.messages) || result.messages.length > 20 ||
        (result.nextCursor !== null && !HEX_ID.test(result.nextCursor))) throw problem("RESPONSE", "The mailbox response could not be read. Please try again.");
    for (const letter of result.messages) {
      if (!HEX_ID.test(letter.id) || !validDate(letter.receivedAt) ||
          !["to", "message", "signature"].every(field => typeof letter[field] === "string") ||
          (letter.reply !== null && typeof letter.reply !== "string")) throw problem("RESPONSE", "A letter could not be read. Please try again.");
    }
    return result.messages;
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function formatImageId(imageId) { return "#" + String(imageId).padStart(3, "0"); }
  function formatLetterDate(value) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "2-digit", year: "numeric"
    }).format(new Date(value)).toUpperCase();
  }
  function senderName(letter) { return letter.signature.trim() || "Anonymous"; }
  function replyTime(letter) { return state.replyStatus[letter.id]?.receivedAt || letter.receivedAt; }
  function reducedMotionEnabled() {
    return window.JeffSite?.reducedMotionEnabled?.() ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function readImageIds(key) {
    try {
      const ids = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(ids) ? [...new Set(ids.map(Number).filter(id =>
        Number.isInteger(id) && id >= 1 && id <= IMAGES.total))] : [];
    } catch (_) { return []; }
  }
  function showNewImageIndicator(viewedCount) {
    clearTimeout(newIndicatorTimer);
    clearTimeout(newIndicatorHideTimer);
    ui.newIndicator.hidden = false;
    ui.newViewedCount.textContent = String(Math.max(0, viewedCount - 1));
    ui.newViewedCount.classList.remove("increment");
    ui.newIndicator.classList.remove("show");
    void ui.newIndicator.offsetWidth;
    ui.newIndicator.setAttribute("aria-hidden", "false");
    ui.newIndicator.classList.add("show");
    newIndicatorTimer = setTimeout(() => {
      ui.newViewedCount.textContent = String(viewedCount);
      ui.newViewedCount.classList.add("increment");
    }, 220);
    newIndicatorHideTimer = setTimeout(hideNewImageIndicator, 2400);
  }
  function hideNewImageIndicator() {
    clearTimeout(newIndicatorHideTimer);
    ui.newIndicator.classList.remove("show");
    ui.newIndicator.setAttribute("aria-hidden", "true");
    ui.newIndicator.hidden = true;
  }
  function recordImageDiscovery(imageId) {
    const viewed = readImageIds(IMAGE_STORAGE.viewed);
    if (viewed.includes(imageId)) return false;
    viewed.push(imageId);
    const recent = readImageIds(IMAGE_STORAGE.recent).filter(id => id !== imageId);
    recent.push(imageId);
    try {
      localStorage.setItem(IMAGE_STORAGE.viewed, JSON.stringify(viewed));
      localStorage.setItem(IMAGE_STORAGE.recent, JSON.stringify(recent.slice(-IMAGES.recentLimit)));
      localStorage.setItem(IMAGE_STORAGE.streak, "0");
      if (viewed.length >= IMAGES.total) localStorage.removeItem(IMAGE_STORAGE.completion);
    } catch (error) {
      console.warn("Could not save the attached image discovery:", error);
      return false;
    }
    showNewImageIndicator(viewed.length);
    document.dispatchEvent(new CustomEvent("jeff:progress-changed"));
    return true;
  }
  function normalizeImageMap(raw, source) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(source + " is invalid.");
    return Object.fromEntries(Object.entries(raw).map(([id, filename]) => [Number(id), filename]).filter(
      ([id, filename]) => Number.isInteger(id) && id >= 1 && id <= IMAGES.total &&
        typeof filename === "string" && filename.trim()
    ));
  }
  async function fetchImageMap(url, source) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load " + source + ".");
    return normalizeImageMap(await response.json(), source);
  }
  function loadImageMaps() {
    if (!imageMapsPromise) {
      imageMapsPromise = Promise.all([
        fetchImageMap(IMAGES.map, "images.json"),
        fetchImageMap(IMAGES.thumbsMap, "thumbs.json")
      ]).then(([images, thumbs]) => ({ images, thumbs })).catch(error => {
        imageMapsPromise = null;
        throw error;
      });
    }
    return imageMapsPromise;
  }
  function loadFortuneMap() {
    if (!fortuneMapPromise) {
      fortuneMapPromise = fetch(FORTUNES.map).then(async response => {
        if (!response.ok) throw new Error("Could not load fortunes.json.");
        const map = await response.json();
        if (!map || typeof map !== "object" || Array.isArray(map) ||
            Object.entries(map).some(([id, filename]) =>
              !/^\d{2}$/.test(id) || Number(id) >= FORTUNES.count ||
              typeof filename !== "string" || /[/\\]/.test(filename) ||
              !/\.(?:png|jpe?g|webp|gif|avif)$/i.test(filename))) {
          throw new Error("The fortune list could not be read.");
        }
        return map;
      }).catch(error => {
        fortuneMapPromise = null;
        throw error;
      });
    }
    return fortuneMapPromise;
  }
  function imageSource(directory, filename) { return directory + encodeURIComponent(filename); }
  function replyAttachments(reply, messageId) {
    const icons = [];
    const images = [];
    const fortunes = [];
    const seen = new Set();
    const text = reply.replace(/\[(\d{3}|f(?:\d{2}|xx)|im[0-9])\]/gi, (token, code) => {
      if (/^im[0-9]$/i.test(code)) {
        icons.push(Number(code[2]));
        return "";
      }
      const kind = /^\d/.test(code) ? "image" : "fortune";
      const id = kind === "image" ? Number(code) :
        code.slice(1).toLowerCase() === "xx"
          ? Number(BigInt("0x" + messageId) % BigInt(FORTUNES.count))
          : Number(code.slice(1));
      if (kind === "image" && (id < 1 || id > IMAGES.total)) return token;
      const key = kind + ":" + id;
      if (!seen.has(key)) {
        (kind === "image" ? images : fortunes).push({ kind, id });
        seen.add(key);
      }
      return "";
    }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { text, icons, images, fortunes };
  }
  function appendReplyIcons(content, ids) {
    if (!ids.length) return;
    const icons = element("div", null, "mailbox-reply-icons");
    icons.setAttribute("role", "group");
    icons.setAttribute("aria-label", "Illustrated sign-offs from Jeff");
    content.append(icons);
    ids.forEach(id => {
      const image = element("img", null, "mailbox-reply-icon");
      image.alt = "Jeff's message icon " + id;
      image.loading = "lazy";
      image.decoding = "async";
      image.draggable = false;
      image.addEventListener("error", () => {
        image.replaceWith(element("span", "Icon unavailable", "mailbox-reply-icon-error"));
      }, { once: true });
      icons.append(image);
      image.src = "/jeff/contact/im/" + id + ".png";
    });
  }
  async function hydrateAttachment(button, imageId) {
    const status = button.querySelector(".mailbox-attachment-status");
    try {
      const maps = await loadImageMaps();
      const filename = maps.thumbs[imageId];
      if (!button.isConnected) return;
      if (!filename) throw new Error("Thumbnail unavailable");
      const image = new Image();
      image.alt = "";
      // Attachments are created only when their reply is opened. Load immediately so
      // an initially hidden thumbnail cannot wait forever for a lazy-load trigger.
      image.loading = "eager";
      image.decoding = "async";
      image.draggable = false;
      image.hidden = true;
      image.addEventListener("load", () => {
        if (!button.isConnected) return;
        status.remove();
        image.hidden = false;
        button.disabled = false;
      }, { once: true });
      image.addEventListener("error", () => {
        image.remove();
        status.textContent = "Picture unavailable";
      }, { once: true });
      status.after(image);
      image.src = imageSource(IMAGES.thumbsDirectory, filename);
    } catch (error) {
      if (button.isConnected) {
        console.error(error);
        status.textContent = "Picture unavailable";
      }
    }
  }
  function appendAttachments(content, items, label) {
    if (!items.length) return;
    const attachments = element("div", null, "mailbox-attachments");
    attachments.setAttribute("role", "group");
    attachments.setAttribute("aria-label", label);
    items.forEach(({ kind, id }) => {
      if (kind === "fortune") {
        const button = element("button", null, "mailbox-fortune-attachment");
        button.type = "button";
        button.dataset.fortuneId = String(id).padStart(2, "0");
        button.setAttribute("aria-label", "Open attached fortune " + button.dataset.fortuneId);
        button.append(element("span", "★", "mailbox-fortune-star"), element("span", "FORTUNE"));
        button.querySelector(".mailbox-fortune-star").setAttribute("aria-hidden", "true");
        button.addEventListener("click", () => openAttachmentViewer("fortune", id, button));
        attachments.append(button);
        return;
      }
      const button = element("button", null, "mailbox-attachment");
      button.type = "button";
      button.disabled = true;
      button.dataset.imageId = String(id);
      button.setAttribute("aria-label", "Open attached image " + formatImageId(id));
      const frame = element("span", null, "mailbox-attachment-frame");
      frame.append(element("span", "Loading picture...", "mailbox-attachment-status"));
      button.append(frame, element("span", formatImageId(id), "mailbox-attachment-id"));
      button.addEventListener("click", () => openAttachmentViewer("image", id, button));
      attachments.append(button);
      hydrateAttachment(button, id);
    });
    content.append(attachments);
  }
  function syncModalState() {
    if (!ui) return;
    const accessibility = document.getElementById("accessibility-overlay");
    ui.page.inert = root.classList.contains("site-menu-open") ||
      (!!accessibility && !accessibility.hidden) || !ui.confirmation.hidden || !ui.imageViewer.hidden;
  }
  function openSentConfirmation() {
    modalFocus = document.activeElement;
    ui.confirmation.hidden = false;
    syncModalState();
    requestAnimationFrame(() => ui.confirmationContinue.focus());
  }
  function closeSentConfirmation() {
    ui.confirmation.hidden = true;
    syncModalState();
    modalFocus?.focus();
    modalFocus = null;
  }
  function clearViewerAnimations() {
    ui.imageFigure.classList.remove("mailbox-slide-in", "mailbox-slide-out", "mailbox-fade-in", "mailbox-fade-out");
  }
  function playViewerAnimation(name, duration) {
    clearViewerAnimations();
    return new Promise(resolve => {
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ui.imageFigure.removeEventListener("animationend", onEnd);
        resolve();
      };
      const onEnd = event => { if (event.target === ui.imageFigure) finish(); };
      ui.imageFigure.addEventListener("animationend", onEnd);
      ui.imageFigure.classList.add(name);
      timer = setTimeout(finish, duration + 200);
    });
  }
  function preloadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load attached image."));
      image.src = source;
    });
  }
  async function openAttachmentViewer(kind, id, trigger) {
    if (imageViewerState !== "closed") return;
    imageViewerState = "loading";
    imageViewerRequest += 1;
    const requestId = imageViewerRequest;
    imageViewerTrigger = trigger;
    const isFortune = kind === "fortune";
    ui.imageViewer.classList.toggle("is-fortune", isFortune);
    ui.imageViewer.setAttribute("aria-label", isFortune ? "Attached fortune from Jeff" : "Attached picture of Jeff");
    ui.imageViewer.hidden = false;
    ui.imageFigure.hidden = true;
    ui.fullImageId.hidden = isFortune;
    ui.imageStatus.hidden = false;
    ui.imageStatus.textContent = isFortune ? "Jeff is writing your fortune..." : "Jeff is fetching your picture...";
    root.classList.add("mailbox-viewer-open");
    syncModalState();
    ui.imageClose.focus();
    try {
      let source;
      if (isFortune) {
        const filename = (await loadFortuneMap())[String(id).padStart(2, "0")];
        if (!filename) throw new Error("This fortune could not be found.");
        source = imageSource(FORTUNES.directory, filename);
      } else {
        const filename = (await loadImageMaps()).images[id];
        if (!filename) throw new Error("This picture could not be found.");
        source = imageSource(IMAGES.directory, filename);
      }
      const preloader = await preloadImage(source);
      if (requestId !== imageViewerRequest) return;
      ui.fullImage.src = preloader.src;
      ui.fullImage.alt = isFortune ? "Fortune from Jeff" : "Full-size image " + formatImageId(id);
      ui.fullImageId.textContent = isFortune ? "" : formatImageId(id);
      ui.imageStatus.hidden = true;
      ui.imageFigure.hidden = false;
      imageViewerState = "opening";
      const reduced = reducedMotionEnabled();
      await playViewerAnimation(reduced ? "mailbox-fade-in" : "mailbox-slide-in", reduced ? 350 : 550);
      if (requestId !== imageViewerRequest) return;
      clearViewerAnimations();
      imageViewerState = "open";
      if (!isFortune) recordImageDiscovery(id);
      ui.fullImage.focus();
    } catch (error) {
      if (requestId !== imageViewerRequest) return;
      console.error(error);
      ui.imageStatus.textContent = error.message || "This picture could not be loaded.";
      ui.imageStatus.hidden = false;
      ui.imageFigure.hidden = true;
      imageViewerState = "error";
    }
  }
  function finishClosingImageViewer() {
    ui.imageViewer.hidden = true;
    ui.imageFigure.hidden = true;
    ui.imageStatus.hidden = false;
    ui.fullImage.removeAttribute("src");
    ui.fullImageId.hidden = false;
    ui.imageViewer.classList.remove("is-fortune");
    clearViewerAnimations();
    root.classList.remove("mailbox-viewer-open");
    imageViewerState = "closed";
    syncModalState();
    imageViewerTrigger?.focus();
    imageViewerTrigger = null;
  }
  async function closeImageViewer() {
    if (imageViewerState === "closed" || imageViewerState === "closing") return;
    imageViewerRequest += 1;
    if (imageViewerState === "loading" || imageViewerState === "error" || ui.imageFigure.hidden) {
      finishClosingImageViewer();
      return;
    }
    imageViewerState = "closing";
    const reduced = reducedMotionEnabled();
    await playViewerAnimation(reduced ? "mailbox-fade-out" : "mailbox-slide-out", reduced ? 350 : 450);
    finishClosingImageViewer();
  }
  function trapFocus(event, container) {
    if (event.key !== "Tab") return;
    const focusable = [...container.querySelectorAll("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")]
      .filter(node => !node.hidden && node.getClientRects().length);
    if (!focusable.length) return;
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
  function updateUnreadCount() {
    const unread = state ? Object.values(state.replyStatus).filter(status => !status.read).length : 0;
    if (!ready) {
      ui.mailboxTab.textContent = "Loading...";
    } else if (unread) {
      const star = element("span", "★", "mailbox-unread-star");
      star.setAttribute("aria-hidden", "true");
      ui.mailboxTab.replaceChildren("Mailbox | ", star, " NEW!");
      ui.mailboxTab.setAttribute("aria-label", "Mailbox, unread replies");
    } else {
      ui.mailboxTab.textContent = "Mailbox";
      ui.mailboxTab.removeAttribute("aria-label");
    }
    ui.mailboxTab.classList.toggle("has-unread", ready && unread > 0);
  }
  function markReplyRead(letter, tab) {
    if (state.replyStatus[letter.id]?.read) return;
    try {
      changeState(saved => { if (saved.replyStatus[letter.id]) saved.replyStatus[letter.id].read = true; });
      tab.classList.remove("is-unread");
      tab.removeAttribute("aria-label");
      tab.replaceChildren(makeHeader(senderName(letter), letter.to, replyTime(letter)));
      updateUnreadCount();
    } catch (error) { fatal(error); }
  }
  function showView(view) {
    const mailbox = view === "mailbox";
    if (mailbox && !ready) return;
    ui.newPanel.hidden = mailbox;
    ui.history.hidden = !mailbox;
    ui.newTab.setAttribute("aria-selected", String(!mailbox));
    ui.mailboxTab.setAttribute("aria-selected", String(mailbox));
    ui.newTab.tabIndex = mailbox ? -1 : 0;
    ui.mailboxTab.tabIndex = mailbox ? 0 : -1;
    ui.subtitle.textContent = mailbox
      ? "Check for responses from Jeff and his team!"
      : "Leave a note for Jefferson, once per day!";
    if (mailbox && !busy) refreshMailbox();
  }
  function makeHeader(to, from, timeValue) {
    const lines = element("span", null, "letter-header-lines");
    lines.append(element("span", "To: " + to), element("span", "From: " + from));
    const line = element("span", "Sent ");
    const time = element("time", formatLetterDate(timeValue));
    time.dateTime = timeValue;
    line.append(time);
    lines.append(line);
    return lines;
  }
  function makeLetterTab(letter, incoming) {
    const unread = incoming && !state.replyStatus[letter.id]?.read;
    const tab = element("button", null, "saved-letter letter-tab " +
      (incoming ? "incoming-letter" : "outgoing-letter") +
      (unread ? " is-unread" : ""));
    tab.type = "button";
    tab.dataset.entry = incoming ? "incoming" : "outgoing";
    tab.id = `letter-${letter.id}-${tab.dataset.entry}`;
    tab.setAttribute("aria-controls", `letter-${letter.id}-content`);
    tab.setAttribute("aria-expanded", "false");
    const author = senderName(letter);
    if (unread) {
      const notice = element("span", null, "letter-unread-label");
      const star = element("span", "★", "letter-unread-star");
      star.setAttribute("aria-hidden", "true");
      notice.append(star, document.createTextNode(" NEW"));
      tab.append(notice);
      tab.setAttribute("aria-label", "New reply from " + letter.to);
    } else {
      tab.append(makeHeader(incoming ? author : letter.to, incoming ? letter.to : author,
        incoming ? replyTime(letter) : letter.receivedAt));
    }
    return tab;
  }
  function openLetter(thread, letter, entry) {
    const panel = thread.querySelector(".thread-content");
    const isOpen = thread.dataset.openEntry === entry;
    thread.dataset.openEntry = isOpen ? "" : entry;
    thread.querySelectorAll(".letter-tab").forEach(tab => {
      tab.setAttribute("aria-expanded", String(!isOpen && tab.dataset.entry === entry));
    });
    panel.replaceChildren();
    panel.hidden = isOpen;
    if (isOpen) return;

    const incoming = entry === "incoming";
    panel.classList.toggle("incoming-letter", incoming);
    panel.setAttribute("aria-labelledby", `letter-${letter.id}-${entry}`);
    if (incoming) {
      const parsed = replyAttachments(letter.reply, letter.id);
      panel.append(element("span", "Reply to your letter", "reply-marker"));
      panel.append(element("p", "Dear " + senderName(letter) + ","));
      if (parsed.text) panel.append(element("p", parsed.text, "letter-text"));
      appendReplyIcons(panel, parsed.icons);
      panel.append(element("p", "Sincerely, " + letter.to, "letter-text"));
      appendAttachments(panel, parsed.images, "Pictures attached to this reply");
      appendAttachments(panel, parsed.fortunes, "Fortunes attached to this reply");
      markReplyRead(letter, thread.querySelector('.letter-tab[data-entry="incoming"]'));
    } else {
      panel.append(element("p", "Dear " + letter.to + ","), element("p", letter.message, "letter-text"));
      if (letter.signature) panel.append(element("p", "Sincerely, " + letter.signature, "letter-text"));
    }
  }
  function renderLetters() {
    const openEntries = new Map([...ui.list.querySelectorAll(".letter-thread[data-open-entry]")]
      .map(thread => [thread.dataset.letterId, thread.dataset.openEntry]));
    const fragment = document.createDocumentFragment();
    const toRestore = [];
    [...letters.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.id.localeCompare(a.id)).forEach(letter => {
      const thread = element("li", null, "letter-thread" + (letter.reply === null ? " is-solo" : ""));
      thread.dataset.letterId = letter.id;
      const outgoing = makeLetterTab(letter, false);
      outgoing.addEventListener("click", () => openLetter(thread, letter, "outgoing"));
      thread.append(outgoing);
      if (letter.reply !== null) {
        const incoming = makeLetterTab(letter, true);
        incoming.addEventListener("click", () => openLetter(thread, letter, "incoming"));
        thread.append(incoming);
      }
      const panel = element("div", null, "saved-letter-content thread-content");
      panel.id = `letter-${letter.id}-content`;
      panel.setAttribute("role", "region");
      panel.hidden = true;
      thread.append(panel);
      fragment.append(thread);
      const previous = openEntries.get(letter.id);
      if (previous === "outgoing" || (previous === "incoming" && letter.reply !== null)) {
        toRestore.push([thread, letter, previous]);
      }
    });
    ui.list.replaceChildren(fragment);
    toRestore.forEach(([thread, letter, entry]) => openLetter(thread, letter, entry));
    updateUnreadCount();
  }
  async function refreshMailbox(older = false) {
    if (busy || !storageReady) return;
    const draft = state && !state.pending && !ui.fields.disabled ? formDraft() : null;
    busy = true;
    connectionFailed = false;
    ui.problem.hidden = true;
    clearTimeout(draftTimer);
    ui.history.setAttribute("aria-busy", "true");
    setStatus(ui.historyStatus, older ? "Jeff's secretary is digging through older mail..." : "Jeff's secretary is checking the mail...");
    updateControls();
    try {
      if (draft) await withLock(() => changeState(saved => { if (!saved.pending) saved.draft = draft; }));
      const result = await request("list", older ? { cursor: nextCursor } : {});
      const found = validateList(result);
      await withLock(() => {
        const saved = readState();
        for (const letter of found) {
          saved.lastReceivedAt = laterDate(saved.lastReceivedAt, letter.receivedAt);
          if (letter.reply !== null && !saved.replyStatus[letter.id]) {
            saved.replyStatus[letter.id] = { receivedAt: new Date().toISOString(), read: false };
          }
          if (saved.pending?.messageId === letter.id) {
            saved.pending = null; saved.draft = emptyDraft();
            setStatus(ui.sendStatus, "Your letter is safely in Jeff's mailbox.");
          }
        }
        writeState(saved);
      });
      if (!older) letters.clear();
      found.forEach(letter => letters.set(letter.id, letter));
      nextCursor = result.nextCursor;
      applyAllowance(result);
      ready = true;
      ui.problem.textContent = "";
      lastRefresh = Date.now();
      restoreDraft(state.pending || state.draft);
      renderLetters();
      setStatus(ui.historyStatus, letters.size ? "Jeff's secretary has finished sorting the mail." : "No letters yet. Jeff may be napping.");
      if (state.pending) setStatus(ui.sendStatus, "Jeff's secretary could not confirm delivery. Retry this same letter.");
    } catch (error) {
      if (error.code === "STORAGE") fatal(error);
      else {
        if (!ready) {
          connectionFailed = true;
          ui.problem.textContent = "Jeff's secretary couldn't reach the mailbox. " + error.message;
          ui.problem.hidden = false;
        }
        setStatus(ui.historyStatus, error.message + " Try again in a moment.", true);
      }
    } finally {
      busy = false;
      ui.history.setAttribute("aria-busy", "false");
      updateControls();
    }
  }
  async function sendLetter(event) {
    event.preventDefault();
    if (busy || !ready || !storageReady) return;
    busy = true;
    clearTimeout(draftTimer);
    let confirmed = false;
    let focusTarget = null;
    updateControls();
    try {
      await withLock(async () => {
        state = readState();
        if (!state.pending && (sentToday() || quotaUntil > Date.now())) {
          setStatus(ui.sendStatus, "Jeff's mailbox is closed for today. Check back tomorrow!");
          return;
        }
        const draft = formDraft();
        const letter = state.pending || validateLetter({
          messageId: randomHex(16), to: draft.to,
          message: normalize(draft.message).trim(), signature: normalize(draft.signature).trim(),
        });
        changeState(saved => { saved.pending = letter; saved.draft = { to: letter.to, message: letter.message, signature: letter.signature }; });
        restoreDraft(letter);
        updateControls();
        setStatus(ui.sendStatus, "Handing your letter to Jeff's secretary...");
        const result = await request("send", letter);
        if (result.messageId !== letter.messageId || !validDate(result.receivedAt)) throw problem("RESPONSE", "Delivery could not be confirmed.");
        confirmed = true;
        markAccepted(letter.messageId, result.receivedAt);
        applyAllowance(result);
        letters.set(letter.messageId, { id: letter.messageId, receivedAt: result.receivedAt,
          to: RECIPIENTS[letter.to[0]],
          message: letter.message, signature: letter.signature, reply: null });
        restoreDraft(state.draft);
        renderLetters();
        setStatus(ui.sendStatus, "Your letter is safely in Jeff's mailbox.");
        setStatus(ui.historyStatus, "Jeff's secretary filed your new letter.");
      });
      if (confirmed) openSentConfirmation();
    } catch (error) {
      if (error.code === "STORAGE") {
        if (confirmed) error.message = "Your letter was delivered, but this browser could not save its receipt. Enable browser storage and reload to retrieve your mailbox.";
        fatal(error);
      } else {
        const rejected = ["DAILY_LIMIT", "INVALID_REQUEST", "INVALID_RECIPIENT", "INVALID_TEXT", "TEXT_LENGTH", "MESSAGE_CONFLICT"].includes(error.code);
        if (rejected) {
          try { await withLock(() => changeState(saved => { saved.pending = null; })); }
          catch (storageError) { fatal(storageError); }
          if (error.code === "DAILY_LIMIT" && validDate(error.nextAvailableAt)) quotaUntil = Date.parse(error.nextAvailableAt);
        }
        setStatus(ui.sendStatus, state.pending ? "Jeff's secretary could not confirm delivery. Your letter is safe here; use “Retry delivery” to check it without sending a duplicate." : error.message, true);
        if (["RECIPIENT", "INVALID_RECIPIENT"].includes(error.code)) focusTarget = ui.recipient;
        else if (["message", "signature"].includes(error.code)) focusTarget = ui[error.code];
      }
    } finally { busy = false; updateControls(); focusTarget?.focus(); }
  }

  async function initialize() {
    if (!checkAccess()) return;
    const get = id => document.getElementById(id);
    ui = {
      page: get("mailbox-page"), form: get("letter-form"), fields: get("letter-fields"),
      subtitle: get("mailbox-subtitle"), newPanel: get("new-letter-panel"),
      newTab: get("new-letter-tab"), mailboxTab: get("your-mailbox-tab"),
      message: get("letter-message"), signature: get("letter-signature"),
      messageCount: get("message-count"), signatureCount: get("signature-count"),
      recipient: get("letter-recipient"),
      send: get("send-letter"), sendStatus: get("send-status"), limit: get("sending-limit"),
      problem: get("mailbox-problem"), history: get("letter-history"), historyStatus: get("history-status"),
      retryConnection: get("mailbox-connect-retry"),
      older: get("older-letters"), list: get("letter-list"),
      confirmation: get("sent-confirmation-overlay"), confirmationContinue: get("sent-confirmation-continue"),
      imageViewer: get("mailbox-image-viewer"), imageClose: get("mailbox-image-close"),
      imageStatus: get("mailbox-image-status"), imageFigure: get("mailbox-image-figure"),
      fullImage: get("mailbox-full-image"), fullImageId: get("mailbox-full-image-id"),
      newIndicator: get("mailbox-new-indicator"), newViewedCount: get("mailbox-viewed-count"),
    };
    root.classList.remove("mailbox-pending");
    ui.form.addEventListener("submit", sendLetter);
    ui.form.addEventListener("input", editDraft);
    ui.recipient.addEventListener("change", editDraft);
    ui.form.addEventListener("compositionend", editDraft);
    document.addEventListener("keydown", handleDebugReset);
    ui.older.addEventListener("click", () => refreshMailbox(true));
    ui.retryConnection.addEventListener("click", () => refreshMailbox());
    ui.newTab.addEventListener("click", () => showView("new"));
    ui.mailboxTab.addEventListener("click", () => showView("mailbox"));
    ui.confirmationContinue.addEventListener("click", closeSentConfirmation);
    ui.imageClose.addEventListener("click", closeImageViewer);
    ui.imageViewer.addEventListener("click", event => { if (event.target === ui.imageViewer) closeImageViewer(); });
    ui.fullImage.addEventListener("click", closeImageViewer);
    ui.fullImage.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closeImageViewer();
      }
    });
    ui.newIndicator.addEventListener("animationend", event => {
      if (event.target !== ui.newIndicator) return;
      hideNewImageIndicator();
    });
    for (const tab of [ui.newTab, ui.mailboxTab]) {
      tab.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const next = tab === ui.newTab ? ui.mailboxTab : ui.newTab;
        if (next.disabled) return;
        next.click(); next.focus();
      });
    }
    document.addEventListener("jeff:history-cleared", checkAccess);
    window.addEventListener("storage", event => {
      if (event.key === "viewedImages" || event.key === null) { if (!checkAccess()) return; }
      if (event.key === CONFIG.storage || event.key === null) {
        try {
          state = readState();
          if (!busy) restoreDraft(state.pending || state.draft);
          renderLetters(); updateControls();
        }
        catch (error) { fatal(error); }
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !checkAccess()) return;
      updateControls();
      if (Date.now() - lastRefresh > 60000) refreshMailbox();
    });
    const overlay = get("accessibility-overlay");
    const observer = new MutationObserver(syncModalState);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
    syncModalState();
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (!ui.confirmation.hidden) closeSentConfirmation();
        else if (!ui.imageViewer.hidden) closeImageViewer();
        return;
      }
      if (!ui.confirmation.hidden) trapFocus(event, ui.confirmation);
      else if (!ui.imageViewer.hidden) trapFocus(event, ui.imageViewer);
    });
    try {
      if (!CONFIG.siteOrigins.includes(location.origin)) throw problem("ORIGIN", "This address is not enabled for Jeff's Mailbox.");
      await withLock(() => { state = readState(true); writeState(state); mailboxKey = state.key; });
      restoreDraft(state.pending || state.draft);
      await refreshMailbox();
    } catch (error) { fatal(error); }
  }
})();
