(() => {
    "use strict";

    const TOTAL_IMAGE_GOAL = 150;

    const STORAGE_KEYS = {
        recent: "recentImages",
        viewed: "viewedImages",
        streak: "noNewImageStreak",
        completion: "collectionCompleteAcknowledged",
        reducedMotion: "reducedMotionPreference",
        simplifiedFont: "simplifiedFontPreference",
        unlockKnown: "menuUnlockKnownLevel",
        unlockPending: "menuUnlockPendingLevel"
    };

    const MENU_LINKS = [
        { label: "Meet Jeff", href: "/jeff/", required: 0 },
        { label: "FAQ", href: "/jeff/faq", required: 0 },
        { label: "Gallery", href: "/jeff/gallery", required: 10 },
        { label: "Help Jeff?", href: "/jeff/help", required: 50 },
        { label: "Contact Jeff", href: "/jeff/contact", required: 75 },
        { label: "Thank you!", href: "/jeff/thanks", required: 150 }
    ];

    const UNLOCK_LEVELS = MENU_LINKS
        .map(link => link.required)
        .filter(required => required > 0);

    const reducedMotionQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );

    let forceNewReady = !document.getElementById("random-image");

    function menuLinkMarkup({ label, href, required }) {
        return `
            <li>
                <a
                    class="site-menu-item"
                    href="${href}"
                    data-unlock="${required}"
                    data-label="${label}"
                >
                    <span>${label}</span>
                    <span
                        class="site-menu-unlock-status"
                        aria-hidden="true"
                    ></span>
                </a>
            </li>
        `;
    }

    document.body.insertAdjacentHTML(
        "beforeend",
        `
            <button
                id="site-menu-toggle"
                type="button"
                aria-controls="site-menu-panel"
                aria-expanded="false"
                aria-label="Open menu"
            >
                <span id="site-menu-toggle-icon" aria-hidden="true">≡</span>
            </button>

            <div
                id="site-menu-unlock-notice"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                hidden
            >
                <span id="site-menu-unlock-arrow" aria-hidden="true">⬅</span>
                <span id="site-menu-unlock-label">New item unlocked!</span>
            </div>

            <div id="site-menu-backdrop" hidden></div>

            <nav
                id="site-menu-panel"
                aria-label="Site menu"
                aria-hidden="true"
            >
                <h2 class="visually-hidden">Site menu</h2>

                <ul id="site-menu-list">
                    ${MENU_LINKS.map(menuLinkMarkup).join("")}

                    <li>
                        <button
                            id="accessibility-button"
                            class="site-menu-item"
                            type="button"
                        >
                            <span>Accessibility</span>
                        </button>
                    </li>

                    <li>
                        <button
                            id="force-new-button"
                            class="site-menu-item"
                            type="button"
                            disabled
                        >
                            <span>Force New</span>
                        </button>
                    </li>

                    <li>
                        <button
                            id="clear-all-button"
                            class="site-menu-item"
                            type="button"
                        >
                            <span>Clear All</span>
                        </button>
                    </li>
                </ul>
            </nav>

            <div
                id="accessibility-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="accessibility-title"
                hidden
            >
                <div id="accessibility-card">
                    <h2 id="accessibility-title">Accessibility</h2>

                    <label class="accessibility-setting">
                        <span>Reduced Motion</span>
                        <input
                            id="reduced-motion-setting"
                            type="checkbox"
                        >
                    </label>

                    <label class="accessibility-setting">
                        <span>Simplify Font</span>
                        <input
                            id="simplified-font-setting"
                            type="checkbox"
                        >
                    </label>

                    <button
                        id="accessibility-close-button"
                        type="button"
                    >
                        Done
                    </button>
                </div>
            </div>
        `
    );

    const root = document.documentElement;
    const menuToggle = document.getElementById("site-menu-toggle");
    const menuIcon = document.getElementById("site-menu-toggle-icon");
    const unlockNotice = document.getElementById(
        "site-menu-unlock-notice"
    );
    const unlockArrow = document.getElementById(
        "site-menu-unlock-arrow"
    );
    const unlockLabel = document.getElementById(
        "site-menu-unlock-label"
    );
    const menuPanel = document.getElementById("site-menu-panel");
    const menuBackdrop = document.getElementById("site-menu-backdrop");
    const accessibilityButton = document.getElementById(
        "accessibility-button"
    );
    const accessibilityOverlay = document.getElementById(
        "accessibility-overlay"
    );
    const accessibilityCloseButton = document.getElementById(
        "accessibility-close-button"
    );
    const reducedMotionSetting = document.getElementById(
        "reduced-motion-setting"
    );
    const simplifiedFontSetting = document.getElementById(
        "simplified-font-setting"
    );
    const forceNewButton = document.getElementById("force-new-button");
    const clearAllButton = document.getElementById("clear-all-button");

    function readStoredBoolean(key, fallback) {
        try {
            const value = localStorage.getItem(key);

            if (value === "true") {
                return true;
            }

            if (value === "false") {
                return false;
            }

        } catch (error) {
            console.warn(`Could not retrieve "${key}":`, error);
        }

        return fallback;
    }

    function saveStoredBoolean(key, value) {
        try {
            localStorage.setItem(key, String(value));

        } catch (error) {
            console.warn(`Could not save "${key}":`, error);
        }
    }

    function applyAccessibilitySettings() {
        const reducedMotion = readStoredBoolean(
            STORAGE_KEYS.reducedMotion,
            reducedMotionQuery.matches
        );

        const simplifiedFont = readStoredBoolean(
            STORAGE_KEYS.simplifiedFont,
            false
        );

        root.classList.toggle("reduced-motion", reducedMotion);
        root.classList.toggle("simplified-font", simplifiedFont);

        if (reducedMotion) {
            unlockArrow.classList.remove("is-announcing");

        } else {
            startUnlockAnimation();
        }

        reducedMotionSetting.checked = reducedMotion;
        simplifiedFontSetting.checked = simplifiedFont;
    }

    function getViewedImageCount() {
        try {
            const storedIds = JSON.parse(
                localStorage.getItem(STORAGE_KEYS.viewed) || "[]"
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
            console.warn(
                "Could not retrieve the viewed image history:",
                error
            );

            return 0;
        }
    }

    function getStoredUnlockLevel(key) {
        try {
            const savedLevel = Number(
                localStorage.getItem(key)
            );

            return UNLOCK_LEVELS.includes(savedLevel)
                ? savedLevel
                : 0;

        } catch (error) {
            console.warn(
                "Could not retrieve the menu unlock state:",
                error
            );

            return 0;
        }
    }

    function saveStoredUnlockLevel(key, level) {
        try {
            localStorage.setItem(
                key,
                String(level)
            );

        } catch (error) {
            console.warn(
                "Could not save the menu unlock state:",
                error
            );
        }
    }

    function clearPendingUnlockNotice() {
        try {
            localStorage.removeItem(STORAGE_KEYS.unlockPending);

        } catch (error) {
            console.warn(
                "Could not clear the menu unlock notice state:",
                error
            );
        }
    }

    function startUnlockAnimation() {
        unlockArrow.classList.remove("is-announcing");

        if (
            unlockNotice.hidden ||
            root.classList.contains("reduced-motion")
        ) {
            return;
        }

        /* Restart only the arrow's bounce. */
        void unlockArrow.offsetWidth;
        unlockArrow.classList.add("is-announcing");
    }

    function hideUnlockNotice(clearPending = false) {
        unlockNotice.hidden = true;
        unlockArrow.classList.remove("is-announcing");

        if (clearPending) {
            clearPendingUnlockNotice();
        }
    }

    function announceNewUnlock(viewedCount) {
        const unlockedLevels = UNLOCK_LEVELS.filter(
            required => viewedCount >= required
        );

        const highestUnlockedLevel = unlockedLevels[
            unlockedLevels.length - 1
        ] || 0;

        const knownLevel = getStoredUnlockLevel(
            STORAGE_KEYS.unlockKnown
        );

        let reachedNewLevel = false;

        if (highestUnlockedLevel > knownLevel) {
            saveStoredUnlockLevel(
                STORAGE_KEYS.unlockKnown,
                highestUnlockedLevel
            );

            saveStoredUnlockLevel(
                STORAGE_KEYS.unlockPending,
                highestUnlockedLevel
            );

            reachedNewLevel = true;
        }

        const pendingLevel = getStoredUnlockLevel(
            STORAGE_KEYS.unlockPending
        );

        if (pendingLevel === 0) {
            return;
        }

        const unlockedLink = MENU_LINKS.find(
            link => link.required === pendingLevel
        );

        const noticeWasHidden = unlockNotice.hidden;

        unlockLabel.textContent = unlockedLink
            ? `"${unlockedLink.label}" unlocked!`
            : "New item unlocked!";
        unlockNotice.hidden = false;

        if (reachedNewLevel || noticeWasHidden) {
            startUnlockAnimation();
        }
    }

    function refreshProgress() {
        const viewedCount = getViewedImageCount();

        document.querySelectorAll("[data-unlock]").forEach(link => {
            const required = Number(link.dataset.unlock);
            const unlocked = viewedCount >= required;
            const label = link.dataset.label;
            const status = link.querySelector(
                ".site-menu-unlock-status"
            );

            link.classList.toggle("is-locked", !unlocked);

            if (unlocked) {
                link.removeAttribute("aria-disabled");
                link.removeAttribute("tabindex");
                link.setAttribute("aria-label", label);
                status.textContent = "";

            } else {
                link.setAttribute("aria-disabled", "true");
                link.setAttribute("tabindex", "-1");
                link.setAttribute(
                    "aria-label",
                    `${label}, locked until ${required} unique pictures are seen`
                );
                status.textContent = `LOCKED · ${required}`;
            }
        });

        const collectionComplete = viewedCount >= TOTAL_IMAGE_GOAL;

        forceNewButton.disabled = (
            collectionComplete ||
            !forceNewReady
        );

        forceNewButton.title = collectionComplete
            ? "All images have already been discovered."
            : "Display an image you have not viewed before.";

        announceNewUnlock(viewedCount);
    }

    function setMenuOpen(open, restoreFocus = true) {
        root.classList.toggle("site-menu-open", open);
        menuPanel.setAttribute("aria-hidden", String(!open));
        menuToggle.setAttribute("aria-expanded", String(open));
        menuToggle.setAttribute(
            "aria-label",
            open ? "Close menu" : "Open menu"
        );
        menuIcon.textContent = open ? "𝝬" : "≡";
        menuBackdrop.hidden = !open;

        if (open) {
            refreshProgress();
            hideUnlockNotice(true);

            requestAnimationFrame(() => {
                menuPanel.querySelector(
                    ".site-menu-item:not([tabindex='-1']):not(:disabled)"
                )?.focus();
            });

        } else if (restoreFocus) {
            menuToggle.focus();
        }
    }

    function openAccessibilityOverlay() {
        setMenuOpen(false, false);
        applyAccessibilitySettings();
        accessibilityOverlay.hidden = false;

        requestAnimationFrame(() => {
            reducedMotionSetting.focus();
        });
    }

    function closeAccessibilityOverlay() {
        accessibilityOverlay.hidden = true;
        menuToggle.focus();
    }

    function trapFocus(event, container, additionalElement = null) {
        if (event.key !== "Tab") {
            return;
        }

        const focusable = [
            ...(additionalElement ? [additionalElement] : []),
            ...container.querySelectorAll(
                "a[href]:not([tabindex='-1']), " +
                "button:not(:disabled), input:not(:disabled)"
            )
        ].filter(element => !element.hidden);

        if (focusable.length === 0) {
            return;
        }

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

    function clearAllSavedImageHistory() {
        const confirmed = window.confirm(
            "Are you sure you want to clear all saved image history?"
        );

        if (!confirmed) {
            return;
        }

        try {
            localStorage.removeItem(STORAGE_KEYS.recent);
            localStorage.removeItem(STORAGE_KEYS.viewed);
            localStorage.removeItem(STORAGE_KEYS.streak);
            localStorage.removeItem(STORAGE_KEYS.completion);
            localStorage.removeItem(STORAGE_KEYS.unlockKnown);
            localStorage.removeItem(STORAGE_KEYS.unlockPending);
            localStorage.removeItem("menuUnlockNoticeLevel");

            hideUnlockNotice();

            refreshProgress();

            document.dispatchEvent(
                new CustomEvent("jeff:history-cleared")
            );

            window.alert(
                "All saved image history has been cleared."
            );

        } catch (error) {
            console.error(
                "Could not clear the saved image history:",
                error
            );

            window.alert(
                "The saved image history could not be cleared."
            );
        }
    }

    menuToggle.addEventListener("click", () => {
        setMenuOpen(!root.classList.contains("site-menu-open"));
    });

    menuBackdrop.addEventListener("click", () => {
        setMenuOpen(false);
    });

    unlockArrow.addEventListener("animationend", event => {
        if (event.target === unlockArrow) {
            unlockArrow.classList.remove("is-announcing");
        }
    });

    menuPanel.addEventListener("click", event => {
        const lockedLink = event.target.closest(
            "[data-unlock][aria-disabled='true']"
        );

        if (lockedLink) {
            event.preventDefault();
            return;
        }

        if (event.target.closest("a[href]")) {
            setMenuOpen(false, false);
        }
    });

    accessibilityButton.addEventListener(
        "click",
        openAccessibilityOverlay
    );

    accessibilityCloseButton.addEventListener(
        "click",
        closeAccessibilityOverlay
    );

    accessibilityOverlay.addEventListener("click", event => {
        if (event.target === accessibilityOverlay) {
            closeAccessibilityOverlay();
        }
    });

    reducedMotionSetting.addEventListener("change", () => {
        saveStoredBoolean(
            STORAGE_KEYS.reducedMotion,
            reducedMotionSetting.checked
        );

        applyAccessibilitySettings();
    });

    simplifiedFontSetting.addEventListener("change", () => {
        saveStoredBoolean(
            STORAGE_KEYS.simplifiedFont,
            simplifiedFontSetting.checked
        );

        applyAccessibilitySettings();
    });

    reducedMotionQuery.addEventListener("change", () => {
        try {
            if (
                localStorage.getItem(
                    STORAGE_KEYS.reducedMotion
                ) === null
            ) {
                applyAccessibilitySettings();
            }

        } catch (error) {
            applyAccessibilitySettings();
        }
    });

    forceNewButton.addEventListener("click", () => {
        setMenuOpen(false, false);

        const forceNewEvent = new CustomEvent(
            "jeff:force-new",
            { cancelable: true }
        );

        if (document.dispatchEvent(forceNewEvent)) {
            const destination = new URL("/jeff/", window.location.origin);
            destination.searchParams.set("forceNew", "1");
            window.location.assign(destination);
        }
    });

    clearAllButton.addEventListener(
        "click",
        clearAllSavedImageHistory
    );

    document.addEventListener("jeff:progress-changed", refreshProgress);

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            if (!accessibilityOverlay.hidden) {
                closeAccessibilityOverlay();

            } else if (root.classList.contains("site-menu-open")) {
                setMenuOpen(false);
            }

            return;
        }

        if (!accessibilityOverlay.hidden) {
            trapFocus(event, accessibilityOverlay);

        } else if (root.classList.contains("site-menu-open")) {
            trapFocus(event, menuPanel, menuToggle);
        }

        if (
            event.key === "Delete" &&
            !event.repeat &&
            !["INPUT", "TEXTAREA", "SELECT"].includes(
                document.activeElement?.tagName
            )
        ) {
            clearAllSavedImageHistory();
        }
    });

    applyAccessibilitySettings();
    refreshProgress();

    window.JeffSite = Object.freeze({
        reducedMotionEnabled: () => (
            root.classList.contains("reduced-motion")
        ),

        getUnlockRequirement(label) {
            const link = MENU_LINKS.find(
                item => item.label === label
            );

            return link ? link.required : null;
        },

        refreshProgress,

        setForceNewReady(ready) {
            forceNewReady = Boolean(ready);
            refreshProgress();
        }
    });
})();
