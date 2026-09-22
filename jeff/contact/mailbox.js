(() => {
  "use strict";

  const CONFIG = Object.freeze({
    endpoint: "https://script.google.com/macros/s/AKfycbw-0qP6on_YKETOgEvCvXHY1sPo6tgcXkNL9e8GBzMZCXiU_MhKfrD5SzWo-ZchGMgQyQ/exec",
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
  const RECIPIENTS = {
    jeff: "Jeff", jefferson: "Jefferson",
    caretaker: "Jeff's Caretaker", legal: "Jeff's Legal Representative",
  };
  const HEX_ID = /^[a-f0-9]{32}$/;
  const HEX_KEY = /^[a-f0-9]{64}$/;
  const root = document.documentElement;
  const letters = new Map();
  let ui, state, mailboxKey, busy = false, ready = false, storageReady = true;
  let quotaUntil = 0, nextCursor = null, dayTimer, draftTimer, lastRefresh = 0;

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
      if (!raw && create) return { version: 1, key: randomHex(32), lastReceivedAt: null, pending: null, draft: emptyDraft() };
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !HEX_KEY.test(saved.key) || (mailboxKey && saved.key !== mailboxKey)) {
        throw new Error("Mailbox identity changed");
      }
      if (saved.lastReceivedAt !== null && !validDate(saved.lastReceivedAt)) throw new Error("Invalid receipt");
      if (saved.pending) validateLetter(saved.pending);
      const draft = saved.draft || emptyDraft();
      if (!Array.isArray(draft.to) || draft.to.some(id => !Object.hasOwn(RECIPIENTS, id)) ||
          typeof draft.message !== "string" || typeof draft.signature !== "string") throw new Error("Invalid draft");
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

  function setStatus(element, message, error = false) {
    element.textContent = message;
    element.dataset.error = String(error);
  }
  function fatal(error) {
    storageReady = false;
    ui.problem.hidden = false;
    ui.problem.textContent = error.message;
    setStatus(ui.historyStatus, "Your mailbox is unavailable.");
    ui.history.setAttribute("aria-busy", "false");
    updateControls();
  }
  function formDraft() {
    return {
      to: ui.recipients.filter(input => input.checked).map(input => input.value),
      message: ui.message.value, signature: ui.signature.value,
    };
  }
  function restoreDraft(draft) {
    ui.recipients.forEach(input => { input.checked = draft.to.includes(input.value); });
    ui.message.value = draft.message;
    ui.signature.value = draft.signature;
    updateCounters();
  }
  function updateCounters() {
    ui.messageCount.textContent = Array.from(normalize(ui.message.value)).length + " / 1,000 characters";
    ui.signatureCount.textContent = Array.from(normalize(ui.signature.value)).length + " / 100 characters";
    ui.recipientLabel.textContent = ui.recipients.filter(input => input.checked).map(input => RECIPIENTS[input.value]).join(", ") || "Choose a recipient";
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
      if (!storageReady || busy) return;
      const saved = readState();
      if (!saved.pending) { saved.draft = formDraft(); writeState(saved); }
    }).catch(fatal), 200);
  }
  function updateControls() {
    if (!ui) return;
    const pending = !!state?.pending;
    const limited = sentToday() || quotaUntil > Date.now();
    ui.fields.disabled = !storageReady || busy || pending;
    ui.send.disabled = !storageReady || busy || !ready || (!pending && limited);
    ui.send.textContent = busy && pending ? "Sending…" : pending ? "Retry delivery" : "Send to Jeff";
    ui.refresh.disabled = !storageReady || busy;
    ui.older.disabled = !storageReady || busy;
    ui.older.hidden = !nextCursor;
    ui.form.setAttribute("aria-busy", String(busy));
    ui.limit.textContent = pending ? "This letter is saved until delivery is confirmed." : !ready ? "Checking your mailbox…" :
      sentToday() ? "You've sent your letter for today. Come back after midnight, in your local time." :
      quotaUntil > Date.now() ? "You can send again after " + new Date(quotaUntil).toLocaleString() + "." :
      "One letter per calendar day. Resets at midnight in your local time.";
    clearTimeout(dayTimer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const wake = quotaUntil > Date.now() ? Math.min(midnight, quotaUntil) : midnight;
    dayTimer = setTimeout(updateControls, Math.max(100, wake - Date.now() + 50));
  }
  function validateLetter(letter) {
    if (!HEX_ID.test(letter.messageId) || !Array.isArray(letter.to) || !letter.to.length ||
        letter.to.some(id => !Object.hasOwn(RECIPIENTS, id))) {
      throw problem("RECIPIENT", "Choose at least one recipient for your letter.");
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
          const error = problem(code, typeof result.error?.message === "string" ? result.error.message : "Jeff's mailbox is unavailable. Please try again.");
          error.nextAvailableAt = result.error?.nextAvailableAt;
          finish(error);
        } else if (result.action === action) finish(null, result);
      };
      window.addEventListener("message", receive);
      timer = setTimeout(() => finish(problem("TIMEOUT", "The mailbox took too long to respond. Please try again.")), CONFIG.timeout);
      try {
        document.body.append(frame, form);
        HTMLFormElement.prototype.submit.call(form);
      } catch (_) { finish(problem("UNAVAILABLE", "The mailbox connection could not be opened. Please try again.")); }
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
  function renderLetters() {
    const openIds = new Set(Array.from(ui.list.querySelectorAll("details[open]"), node => node.dataset.id));
    const firstRender = !ui.list.children.length;
    const fragment = document.createDocumentFragment();
    const sorted = [...letters.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.id.localeCompare(a.id));
    sorted.forEach((letter, index) => {
      const item = element("li");
      const details = element("details", null, "saved-letter");
      details.dataset.id = letter.id;
      details.open = openIds.has(letter.id) || (firstRender && index === 0);
      const summary = element("summary");
      const time = element("time", new Date(letter.receivedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
      time.dateTime = letter.receivedAt;
      summary.append(time, element("span", letter.reply !== null ? "Jeff replied" : "Sent", letter.reply !== null ? "reply-label" : ""));
      const content = element("div", null, "saved-letter-content");
      content.append(element("p", "Dear " + letter.to + ","), element("p", letter.message, "letter-text"));
      if (letter.signature) content.append(element("p", "Sincerely, " + letter.signature, "letter-text"));
      if (letter.reply !== null) {
        const reply = element("div", null, "jeff-reply");
        reply.append(element("h3", "Jeff wrote back"), element("p", letter.reply, "letter-text"));
        content.append(reply);
      }
      details.append(summary, content); item.append(details); fragment.append(item);
    });
    ui.list.replaceChildren(fragment);
  }
  async function refreshMailbox(older = false) {
    if (busy || !storageReady) return;
    const draft = state && !state.pending && !ui.fields.disabled ? formDraft() : null;
    busy = true;
    clearTimeout(draftTimer);
    ui.history.setAttribute("aria-busy", "true");
    setStatus(ui.historyStatus, older ? "Opening older letters…" : "Checking for letters and replies…");
    updateControls();
    try {
      if (draft) await withLock(() => changeState(saved => { if (!saved.pending) saved.draft = draft; }));
      const result = await request("list", older ? { cursor: nextCursor } : {});
      const found = validateList(result);
      await withLock(() => {
        const saved = readState();
        for (const letter of found) {
          saved.lastReceivedAt = laterDate(saved.lastReceivedAt, letter.receivedAt);
          if (saved.pending?.messageId === letter.id) {
            saved.pending = null; saved.draft = emptyDraft();
            setStatus(ui.sendStatus, "Your letter was delivered to Jeff's mailbox.");
          }
        }
        writeState(saved);
      });
      if (!older) letters.clear();
      found.forEach(letter => letters.set(letter.id, letter));
      nextCursor = result.nextCursor;
      applyAllowance(result);
      ready = true;
      lastRefresh = Date.now();
      restoreDraft(state.pending || state.draft);
      renderLetters();
      setStatus(ui.historyStatus, letters.size ? "Your mailbox is up to date." : "No letters yet. Your first one can start right above.");
      if (state.pending) setStatus(ui.sendStatus, "Delivery has not been confirmed. Retry delivery to check this same letter.");
    } catch (error) {
      if (error.code === "STORAGE") fatal(error);
      else setStatus(ui.historyStatus, error.message + " Use “Check for replies” to retry.", true);
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
          setStatus(ui.sendStatus, "Your sending allowance has been used. Please return when the next letter is available.");
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
        setStatus(ui.sendStatus, "Sending your letter…");
        const result = await request("send", letter);
        if (result.messageId !== letter.messageId || !validDate(result.receivedAt)) throw problem("RESPONSE", "Delivery could not be confirmed.");
        confirmed = true;
        markAccepted(letter.messageId, result.receivedAt);
        applyAllowance(result);
        letters.set(letter.messageId, { id: letter.messageId, receivedAt: result.receivedAt,
          to: Object.keys(RECIPIENTS).filter(id => letter.to.includes(id)).map(id => RECIPIENTS[id]).join(", "),
          message: letter.message, signature: letter.signature, reply: null });
        restoreDraft(state.draft);
        renderLetters();
        setStatus(ui.sendStatus, "Delivered! Your letter is in Jeff's mailbox. Check below for any reply.");
        setStatus(ui.historyStatus, "Your sent letter is shown below.");
      });
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
        setStatus(ui.sendStatus, state.pending ? "We couldn't confirm delivery. Your letter is saved here. Use “Retry delivery” to check the same letter without sending a duplicate." : error.message, true);
        if (error.code === "RECIPIENT") { ui.picker.open = true; focusTarget = ui.picker.querySelector("summary"); }
        else if (["message", "signature"].includes(error.code)) focusTarget = ui[error.code];
      }
    } finally { busy = false; updateControls(); focusTarget?.focus(); }
  }

  async function initialize() {
    if (!checkAccess()) return;
    const get = id => document.getElementById(id);
    ui = {
      page: get("mailbox-page"), form: get("letter-form"), fields: get("letter-fields"),
      message: get("letter-message"), signature: get("letter-signature"),
      messageCount: get("message-count"), signatureCount: get("signature-count"),
      recipients: [...document.querySelectorAll('[name="recipient"]')],
      picker: get("recipient-picker"), recipientLabel: get("recipient-label"),
      send: get("send-letter"), sendStatus: get("send-status"), limit: get("sending-limit"),
      problem: get("mailbox-problem"), history: get("letter-history"), historyStatus: get("history-status"),
      refresh: get("refresh-mailbox"), older: get("older-letters"), list: get("letter-list"),
    };
    root.classList.remove("mailbox-pending");
    ui.form.addEventListener("submit", sendLetter);
    ui.form.addEventListener("input", editDraft);
    ui.form.addEventListener("compositionend", editDraft);
    ui.refresh.addEventListener("click", () => refreshMailbox());
    ui.older.addEventListener("click", () => refreshMailbox(true));
    ui.picker.addEventListener("keydown", event => {
      if (event.key === "Escape") { ui.picker.open = false; ui.picker.querySelector("summary").focus(); }
    });
    document.addEventListener("pointerdown", event => { if (!ui.picker.contains(event.target)) ui.picker.open = false; });
    document.addEventListener("jeff:history-cleared", checkAccess);
    window.addEventListener("storage", event => {
      if (event.key === "viewedImages" || event.key === null) { if (!checkAccess()) return; }
      if (event.key === CONFIG.storage || event.key === null) {
        try { state = readState(); if (!busy) restoreDraft(state.pending || state.draft); updateControls(); }
        catch (error) { fatal(error); }
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !checkAccess()) return;
      updateControls();
      if (Date.now() - lastRefresh > 60000) refreshMailbox();
    });
    const overlay = get("accessibility-overlay");
    const syncModal = () => { ui.page.inert = root.classList.contains("site-menu-open") || !!overlay && !overlay.hidden; };
    const observer = new MutationObserver(syncModal);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
    syncModal();
    try {
      if (!CONFIG.siteOrigins.includes(location.origin)) throw problem("ORIGIN", "This address is not enabled for Jeff's Mailbox.");
      await withLock(() => { state = readState(true); writeState(state); mailboxKey = state.key; });
      restoreDraft(state.pending || state.draft);
      await refreshMailbox();
    } catch (error) { fatal(error); }
  }
})();
