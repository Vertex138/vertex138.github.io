(() => {
    "use strict";

    const FAQ_UNLOCK_REQUIREMENT = 25;
    const TOTAL_IMAGE_GOAL = 150;
    const VIEWED_IMAGES_KEY = "viewedImages";

    const ROOT_PAGE = "/jeff/";
    const FAQ_DATA_SOURCE = "/jeff/faq/faq.json";

    function getViewedImageCount() {
        try {
            const storedIds = JSON.parse(
                localStorage.getItem(VIEWED_IMAGES_KEY) || "[]"
            );

            if (!Array.isArray(storedIds)) {
                return 0;
            }

            return new Set(
                storedIds
                    .map(Number)
                    .filter(imageId => (
                        Number.isInteger(imageId) &&
                        imageId >= 1 &&
                        imageId <= TOTAL_IMAGE_GOAL
                    ))
            ).size;

        } catch (error) {
            return 0;
        }
    }

    function redirectIfFaqIsLocked() {
        if (getViewedImageCount() >= FAQ_UNLOCK_REQUIREMENT) {
            return false;
        }

        window.location.replace(ROOT_PAGE);
        return true;
    }

    /*
     * Run the access check while this blocking script is still in <head>.
     * Locked visitors are redirected before the rest of the page is parsed.
     */

    if (redirectIfFaqIsLocked()) {
        return;
    }

    document.documentElement.style.display = "";

    function validateFaqData(faqData) {
        if (
            faqData === null ||
            typeof faqData !== "object" ||
            Array.isArray(faqData)
        ) {
            throw new Error(
                "faq.json must map questions to answers."
            );
        }

        const entries = Object.entries(faqData)
            .filter(([question, answer]) => (
                question.trim() !== "" &&
                typeof answer === "string" &&
                answer.trim() !== ""
            ));

        if (entries.length === 0) {
            throw new Error(
                "faq.json does not contain any valid entries."
            );
        }

        return entries;
    }

    function createFaqEntry(question, answer) {
        const entry = document.createElement("article");
        const heading = document.createElement("h2");
        const answerText = document.createElement("p");

        entry.className = "faq-entry";
        heading.className = "faq-question";
        answerText.className = "faq-answer";

        heading.textContent = question;
        answerText.textContent = answer;

        entry.append(heading, answerText);

        return entry;
    }

    async function loadFaq() {
        const faqList = document.getElementById("faq-list");
        const status = document.getElementById("faq-status");

        try {
            const response = await fetch(FAQ_DATA_SOURCE);

            if (!response.ok) {
                throw new Error(
                    `Could not load faq.json: ${response.status}`
                );
            }

            const entries = validateFaqData(
                await response.json()
            );

            const fragment = document.createDocumentFragment();

            entries.forEach(([question, answer]) => {
                fragment.append(
                    createFaqEntry(question, answer)
                );
            });

            faqList.replaceChildren(fragment);

        } catch (error) {
            console.error(error);

            status.textContent =
                "Jeff's FAQ could not be loaded.";

            faqList.replaceChildren(status);

        } finally {
            faqList.setAttribute("aria-busy", "false");
        }
    }

    window.addEventListener("pageshow", redirectIfFaqIsLocked);

    window.addEventListener("storage", event => {
        if (event.key === VIEWED_IMAGES_KEY) {
            redirectIfFaqIsLocked();
        }
    });

    document.addEventListener(
        "jeff:history-cleared",
        redirectIfFaqIsLocked
    );

    document.addEventListener(
        "DOMContentLoaded",
        loadFaq,
        { once: true }
    );
})();
