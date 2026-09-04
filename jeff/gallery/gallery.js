(() => {
    "use strict";

    const TOTAL_IMAGE_GOAL = 150;
    const VIEWED_IMAGES_KEY = "viewedImages";

    const SITE_DIRECTORY = "/jeff/";
    const THUMB_DIRECTORY = `${SITE_DIRECTORY}thumbs/`;
    const IMAGE_DIRECTORY = `${SITE_DIRECTORY}images/`;
    const MISSING_THUMBNAIL = `${THUMB_DIRECTORY}t_missing.jpg`;

    const THUMB_MAP_SOURCE = `${SITE_DIRECTORY}thumbs.json`;
    const IMAGE_MAP_SOURCE = `${SITE_DIRECTORY}images.json`;

    const reducedMotionQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );

    const grid = document.getElementById("gallery-grid");
    const progress = document.getElementById("gallery-progress");
    const errorPanel = document.getElementById("gallery-error");
    const retryButton = document.getElementById("gallery-retry-button");

    const viewer = document.getElementById("gallery-viewer");
    const viewerClose = document.getElementById("gallery-viewer-close");
    const viewerStatus = document.getElementById("gallery-viewer-status");
    const viewerFigure = document.getElementById("gallery-viewer-figure");
    const fullImage = document.getElementById("gallery-full-image");
    const fullImageId = document.getElementById("gallery-full-id");

    const cardByImageId = new Map();

    let thumbnailMap = {};
    let imageMap = {};
    let loadObserver = null;
    let thumbnailOpacityFrame = null;
    let activeThumbnail = null;
    let viewerState = "closed";
    let viewerRequestId = 0;

    function isValidImageId(value) {
        return (
            Number.isInteger(value) &&
            value >= 1 &&
            value <= TOTAL_IMAGE_GOAL
        );
    }

    function formatImageId(imageId) {
        return `#${String(imageId).padStart(3, "0")}`;
    }

    function reducedMotionEnabled() {
        if (
            window.JeffSite &&
            typeof window.JeffSite.reducedMotionEnabled === "function"
        ) {
            return window.JeffSite.reducedMotionEnabled();
        }

        return reducedMotionQuery.matches;
    }

    function getViewedImageIds() {
        try {
            const storedIds = JSON.parse(
                localStorage.getItem(VIEWED_IMAGES_KEY) || "[]"
            );

            if (!Array.isArray(storedIds)) {
                return [];
            }

            return [
                ...new Set(
                    storedIds
                        .map(Number)
                        .filter(isValidImageId)
                )
            ];

        } catch (error) {
            console.warn(
                "Could not retrieve the viewed image history:",
                error
            );

            return [];
        }
    }

    function normalizeImageMap(rawMap, sourceName) {
        if (
            rawMap === null ||
            typeof rawMap !== "object" ||
            Array.isArray(rawMap)
        ) {
            throw new Error(
                `${sourceName} must map numerical IDs to filenames.`
            );
        }

        return Object.fromEntries(
            Object.entries(rawMap)
                .map(([rawId, filename]) => [
                    Number(rawId),
                    filename
                ])
                .filter(([imageId, filename]) => (
                    isValidImageId(imageId) &&
                    typeof filename === "string" &&
                    filename.trim() !== ""
                ))
        );
    }

    async function fetchImageMap(source, sourceName) {
        const response = await fetch(source);

        if (!response.ok) {
            throw new Error(
                `Could not load ${sourceName}: ${response.status}`
            );
        }

        return normalizeImageMap(
            await response.json(),
            sourceName
        );
    }

    function imageSource(directory, filename) {
        return directory + encodeURIComponent(filename);
    }

    function getThumbnailSource(imageId, unlocked) {
        if (!unlocked || !thumbnailMap[imageId]) {
            return MISSING_THUMBNAIL;
        }

        return imageSource(
            THUMB_DIRECTORY,
            thumbnailMap[imageId]
        );
    }

    function unmountThumbnail(card) {
        const frame = card.querySelector(
            ".gallery-thumbnail-frame"
        );

        const image = frame.querySelector("img");

        if (!image) {
            return;
        }

        image.removeAttribute("src");
        image.remove();
        frame.classList.remove("has-image");
    }

    function mountThumbnail(card) {
        const frame = card.querySelector(
            ".gallery-thumbnail-frame"
        );

        if (frame.querySelector("img")) {
            return;
        }

        const image = document.createElement("img");

        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.draggable = false;

        if (card.dataset.source === MISSING_THUMBNAIL) {
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
            image.src = MISSING_THUMBNAIL;
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
        card.setAttribute(
            "aria-label",
            unlocked
                ? `Open image ${formatImageId(imageId)}`
                : `Image ${formatImageId(imageId)}, not yet discovered`
        );

        if (
            oldSource !== undefined &&
            oldSource !== newSource
        ) {
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

        openFullImage(
            Number(card.dataset.imageId),
            card
        );
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
            if (
                event.animationName === "galleryLockedShake" ||
                event.animationName === "galleryLockedShakeReduced"
            ) {
                card.classList.remove("shake-locked");
            }
        });

        return card;
    }

    function updateThumbnailOpacity(card) {
        const frame = card.querySelector(
            ".gallery-thumbnail-frame"
        );

        const bounds = frame.getBoundingClientRect();
        const viewportBottom = document.documentElement.clientHeight;

        let opacity = 1;

        if (bounds.top >= viewportBottom) {
            opacity = 0;

        } else if (
            bounds.top >= 0 &&
            bounds.bottom > viewportBottom
        ) {
            opacity = (
                viewportBottom - bounds.top
            ) / bounds.height;
        }

        card.style.opacity = String(
            Math.max(0, Math.min(1, opacity))
        );
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

        thumbnailOpacityFrame = requestAnimationFrame(
            updateNearbyThumbnailOpacities
        );
    }

    function observeThumbnailCards() {
        const cards = [...cardByImageId.values()];

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

                    card.style.opacity =
                        entry.boundingClientRect.top >=
                        document.documentElement.clientHeight
                            ? "0"
                            : "1";
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
            const card = createThumbnailCard(
                imageId,
                viewedIds.has(imageId)
            );

            cardByImageId.set(imageId, card);
            fragment.append(card);
        }

        grid.replaceChildren(fragment);
        grid.setAttribute("aria-busy", "false");

        refreshGalleryUnlocks();
        observeThumbnailCards();
    }

    function refreshGalleryUnlocks() {
        if (cardByImageId.size === 0) {
            return;
        }

        const viewedIds = new Set(getViewedImageIds());
        const viewedCount = viewedIds.size;

        const progressText = (
            `${viewedCount} / ${TOTAL_IMAGE_GOAL} discovered`
        );

        if (viewedCount === TOTAL_IMAGE_GOAL) {
            const createStar = () => {
                const star = document.createElement("span");

                star.className = "gallery-complete-star";
                star.setAttribute("aria-hidden", "true");
                star.textContent = "★";

                return star;
            };

            progress.replaceChildren(
                createStar(),
                document.createTextNode(` ${progressText} `),
                createStar()
            );

            progress.setAttribute(
                "aria-label",
                `${progressText}. Collection complete.`
            );

        } else {
            progress.textContent = progressText;
            progress.removeAttribute("aria-label");
        }

        cardByImageId.forEach((card, imageId) => {
            setCardUnlockState(
                card,
                viewedIds.has(imageId)
            );
        });
    }

    function clearViewerAnimationClasses() {
        viewerFigure.classList.remove(
            "gallery-slide-in",
            "gallery-slide-out",
            "gallery-fade-in",
            "gallery-fade-out"
        );
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
                viewerFigure.removeEventListener(
                    "animationend",
                    handleAnimationEnd
                );
                resolve();
            };

            const handleAnimationEnd = event => {
                if (event.target === viewerFigure) {
                    finish();
                }
            };

            viewerFigure.addEventListener(
                "animationend",
                handleAnimationEnd
            );

            viewerFigure.classList.add(animationClass);
            fallbackTimer = setTimeout(finish, duration + 200);
        });
    }

    function preloadImage(source) {
        return new Promise((resolve, reject) => {
            const preloader = new Image();

            preloader.onload = () => resolve(preloader);
            preloader.onerror = () => reject(
                new Error(`Could not load image: ${source}`)
            );
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

        activeThumbnail?.focus();
        activeThumbnail = null;
    }

    async function openFullImage(imageId, trigger) {
        if (viewerState !== "closed") {
            return;
        }

        const filename = imageMap[imageId];

        activeThumbnail = trigger;
        viewerState = "loading";
        viewerRequestId += 1;

        const requestId = viewerRequestId;
        let preloader = null;

        viewer.hidden = false;
        viewerFigure.hidden = true;
        viewerStatus.hidden = false;
        viewerStatus.textContent = "Loading image…";
        document.documentElement.classList.add("gallery-viewer-open");
        viewerClose.focus();

        if (!filename) {
            viewerStatus.textContent = "This image could not be found.";
            viewerState = "error";
            return;
        }

        try {
            preloader = await preloadImage(
                imageSource(IMAGE_DIRECTORY, filename)
            );

            if (requestId !== viewerRequestId) {
                return;
            }

            fullImage.src = preloader.src;
            fullImage.alt = `Full-size image ${formatImageId(imageId)}`;
            fullImageId.textContent = formatImageId(imageId);

            viewerStatus.hidden = true;
            viewerFigure.hidden = false;
            viewerState = "opening";

            const useReducedMotion = reducedMotionEnabled();

            await playViewerAnimation(
                useReducedMotion
                    ? "gallery-fade-in"
                    : "gallery-slide-in",
                useReducedMotion ? 350 : 550
            );

            if (requestId !== viewerRequestId) {
                return;
            }

            clearViewerAnimationClasses();
            viewerState = "open";
            fullImage.focus();

        } catch (error) {
            if (requestId !== viewerRequestId) {
                return;
            }

            console.error(error);
            viewerStatus.hidden = false;
            viewerStatus.textContent = "This image could not be loaded.";
            viewerFigure.hidden = true;
            viewerState = "error";

        } finally {
            releasePreloader(preloader);
        }
    }

    async function closeFullImage() {
        if (
            viewerState === "closed" ||
            viewerState === "closing"
        ) {
            return;
        }

        viewerRequestId += 1;

        if (
            viewerState === "loading" ||
            viewerState === "error" ||
            viewerFigure.hidden
        ) {
            finishClosingViewer();
            return;
        }

        viewerState = "closing";

        const useReducedMotion = reducedMotionEnabled();

        await playViewerAnimation(
            useReducedMotion
                ? "gallery-fade-out"
                : "gallery-slide-out",
            useReducedMotion ? 350 : 450
        );

        finishClosingViewer();
    }

    function trapViewerFocus(event) {
        if (event.key !== "Tab" || viewer.hidden) {
            return;
        }

        const focusable = viewerFigure.hidden
            ? [viewerClose]
            : [viewerClose, fullImage];

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
        errorPanel.hidden = true;
        progress.textContent = "Loading gallery…";

        try {
            [thumbnailMap, imageMap] = await Promise.all([
                fetchImageMap(THUMB_MAP_SOURCE, "thumbs.json"),
                fetchImageMap(IMAGE_MAP_SOURCE, "images.json")
            ]);

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

    window.addEventListener(
        "scroll",
        scheduleThumbnailOpacityUpdate,
        { passive: true }
    );

    window.addEventListener(
        "resize",
        scheduleThumbnailOpacityUpdate,
        { passive: true }
    );

    window.addEventListener("storage", event => {
        if (event.key === VIEWED_IMAGES_KEY) {
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
