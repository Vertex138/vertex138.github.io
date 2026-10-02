(() => {
  "use strict";

  const FAQ_UNLOCK_REQUIREMENT = 40;
  const TOTAL_IMAGE_GOAL = 150;
  const VIEWED_IMAGES_KEY = "viewedImages";
  const ROOT_PAGE = "/jeff/";
  const FAQ_DATA_SOURCE = "/jeff/faq/faq.json";
  const DRAFT_ANSWER = "ANSWER ME";
  const DRAFT_COMMENT = "COMMENT HERE";

  function getViewedImageCount() {
    try {
      const ids = JSON.parse(localStorage.getItem(VIEWED_IMAGES_KEY) || "[]");
      if (!Array.isArray(ids)) return 0;
      return new Set(ids.map(Number).filter(id =>
        Number.isInteger(id) && id >= 1 && id <= TOTAL_IMAGE_GOAL
      )).size;
    } catch (error) {
      return 0;
    }
  }

  function redirectIfFaqIsLocked() {
    if (getViewedImageCount() >= FAQ_UNLOCK_REQUIREMENT) return false;
    window.location.replace(ROOT_PAGE);
    return true;
  }

  // Run before the page markup loads so locked visitors never see its contents.
  if (redirectIfFaqIsLocked()) return;
  document.documentElement.style.display = "";

  function validateFaqData(data) {
    if (!data || !Array.isArray(data.categories) || !data.categories.length) {
      throw new Error("faq.json must contain a nonempty categories array.");
    }
    const ids = new Set();
    for (const category of data.categories) {
      if (!/^[a-z0-9-]+$/.test(category.id) || ids.has(category.id) ||
          !category.label?.trim() || !category.subtitle?.trim() ||
          !Array.isArray(category.questions)) {
        throw new Error("faq.json contains an invalid category.");
      }
      ids.add(category.id);
      for (const item of category.questions) {
        if (!item || typeof item.question !== "string" || !item.question.trim() ||
            typeof item.answer !== "string" || !item.answer.trim() ||
            (item.comment !== undefined && typeof item.comment !== "string")) {
          throw new Error(`faq.json contains an invalid question in ${category.id}.`);
        }
      }
    }
    return data.categories;
  }

  function createQuestion(item) {
    const entry = document.createElement("details");
    const question = document.createElement("summary");
    const heading = document.createElement("h2");
    const body = document.createElement("div");
    const answer = document.createElement("p");

    entry.className = "faq-entry";
    question.className = "faq-question";
    body.className = "faq-body";
    answer.className = "faq-answer";
    heading.textContent = item.question;
    answer.textContent = item.answer;
    question.append(heading);
    body.append(answer);

    if (item.comment?.trim() && item.comment.trim() !== DRAFT_COMMENT) {
      const comment = document.createElement("p");
      comment.className = "faq-comment";
      comment.textContent = `Jeff adds: ${item.comment}`;
      body.append(comment);
    }

    entry.append(question, body);
    return entry;
  }

  async function loadFaq() {
    const content = document.getElementById("faq-content");
    const status = document.getElementById("faq-status");
    const categoriesView = document.getElementById("faq-categories");
    const questionsView = document.getElementById("faq-questions-view");
    const buttons = document.getElementById("faq-category-buttons");
    const list = document.getElementById("faq-list");
    const subtitle = document.getElementById("faq-subtitle");
    const back = document.getElementById("faq-back");
    const image = document.getElementById("faq-image");

    try {
      const response = await fetch(FAQ_DATA_SOURCE);
      if (!response.ok) throw new Error(`Could not load faq.json: ${response.status}`);
      const categories = validateFaqData(await response.json());
      const byId = new Map(categories.map(category => [category.id, category]));
      const buttonById = new Map();
      let currentId = null;
      let switching = false;
      let activeAnimation = null;
      let generation = 0;

      function categoryFromUrl() {
        try {
          const id = decodeURIComponent(location.hash.slice(1));
          return byId.has(id) ? id : null;
        } catch (error) {
          return null;
        }
      }

      function renderQuestions(id) {
        const entries = byId.get(id).questions
          .filter(item => item.answer.trim() !== DRAFT_ANSWER)
          .map(createQuestion);
        list.replaceChildren(...entries);
        image.hidden = false;
      }

      function focusView(id, previousId) {
        (id ? back : buttonById.get(previousId) || buttons.firstElementChild)?.focus();
      }

      function setViewImmediately(id, focus = false) {
        const previousId = currentId;
        generation++;
        activeAnimation?.cancel();
        activeAnimation = null;
        switching = false;
        currentId = id;
        categoriesView.hidden = id !== null;
        questionsView.hidden = id === null;
        if (id) renderQuestions(id);
        subtitle.textContent = id ? byId.get(id).subtitle : "What do you want to ask about?";
        content.setAttribute("aria-busy", "false");
        if (focus) focusView(id, previousId);
      }

      function reducedMotion() {
        return document.documentElement.classList.contains("reduced-motion") ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }

      async function animateView(element, entering, direction) {
        if (!element.animate) return;
        const opacityFrames = entering ? [{ opacity: 0 }, { opacity: 1 }] :
          [{ opacity: 1 }, { opacity: 0 }];
        const frames = reducedMotion() ? opacityFrames : entering ?
          [{ transform: `translateX(${-direction * 100}vw)` }, { transform: "translateX(0)" }] :
          [{ transform: "translateX(0)" }, { transform: `translateX(${direction * 100}vw)` }];
        const animation = element.animate(frames, {
          duration: reducedMotion() ? 180 : 260,
          easing: "ease-in-out"
        });
        activeAnimation = animation;
        try {
          await animation.finished;
        } catch (error) {
          // A newer navigation cancelled this animation.
        }
        if (activeAnimation === animation) activeAnimation = null;
      }

      async function switchView(id, focus = true) {
        if (id === currentId && !switching) return;
        if (switching) {
          setViewImmediately(id, focus);
          return;
        }
        switching = true;
        content.setAttribute("aria-busy", "true");
        const token = ++generation;
        const previousId = currentId;
        const direction = id ? -1 : 1;
        const outgoing = currentId ? questionsView : categoriesView;
        const incoming = id ? questionsView : categoriesView;

        await animateView(outgoing, false, direction);
        if (generation !== token) return;
        outgoing.hidden = true;
        subtitle.textContent = id ? byId.get(id).subtitle : "What do you want to ask about?";
        if (id) renderQuestions(id);
        incoming.hidden = false;
        window.scrollTo(0, 0);
        await animateView(incoming, true, direction);
        if (generation !== token) return;
        currentId = id;
        switching = false;
        content.setAttribute("aria-busy", "false");
        if (focus) focusView(id, previousId);
      }

      for (const category of categories) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "faq-control-button";
        button.textContent = category.label;
        button.addEventListener("click", () => {
          if (switching) return;
          history.pushState({ faqCategory: category.id }, "", `#${category.id}`);
          switchView(category.id);
        });
        buttons.append(button);
        buttonById.set(category.id, button);
      }

      back.addEventListener("click", () => {
        if (!switching) history.back();
      });
      window.addEventListener("popstate", () => switchView(categoryFromUrl()));

      const initialId = categoryFromUrl();
      if (initialId && !history.state?.faqCategory) {
        // Give direct category links their own chooser entry for the Back button.
        history.replaceState({ faqChooser: true }, "", location.pathname + location.search);
        history.pushState({ faqCategory: initialId }, "", `#${initialId}`);
      }
      status.hidden = true;
      setViewImmediately(initialId);
    } catch (error) {
      console.error(error);
      status.textContent = "Jeff couldn't find the answers. Please try again later.";
      status.hidden = false;
      categoriesView.hidden = true;
      questionsView.hidden = true;
    } finally {
      content.setAttribute("aria-busy", "false");
    }
  }

  window.addEventListener("pageshow", redirectIfFaqIsLocked);
  window.addEventListener("storage", event => {
    if (event.key === VIEWED_IMAGES_KEY) redirectIfFaqIsLocked();
  });
  document.addEventListener("jeff:history-cleared", redirectIfFaqIsLocked);
  document.addEventListener("DOMContentLoaded", loadFaq, { once: true });
})();
