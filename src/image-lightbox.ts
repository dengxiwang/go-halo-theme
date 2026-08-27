import Swiper from "swiper";
import "swiper/css/zoom";
import { Zoom } from "swiper/modules";
import { disableScroll, enableScroll } from "./scrollbar";

const GALLERY_SELECTOR = "[data-image-gallery]";
const EXPLICIT_GALLERY_VALUE = "explicit";
const IMAGE_URL_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|jxl|png|svg|tiff?|webp)(?:$|[?#])/i;
const NON_PREVIEW_IMAGE_SELECTOR = '.emoji, .emojione, [data-emoji], [aria-hidden="true"], [role="presentation"]';
const MIN_ZOOM_RATIO = 1;
const MAX_ZOOM_RATIO = 4;
const DEFAULT_ZOOM_RATIO = 2.5;
const ZOOM_STEP = 0.5;
const WHEEL_ZOOM_SENSITIVITY = 0.002;

type ViewerElements = {
  dialog: HTMLDialogElement;
  swiperContainer: HTMLElement;
  wrapper: HTMLElement;
  status: HTMLElement;
  closeButton: HTMLButtonElement;
  zoomButton: HTMLButtonElement;
  previousButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  caption: HTMLElement;
  title: HTMLElement;
  description: HTMLElement;
  counter: HTMLElement;
};

type ImageDetails = {
  src: string;
  alt: string;
  title: string;
  description: string;
};

let viewer: ViewerElements | null = null;
let imageSwiper: Swiper | null = null;
let activeImages: HTMLImageElement[] = [];
let activeIndex = -1;
let lastTrigger: HTMLElement | null = null;
let scrollLocked = false;
let gestureStartZoomRatio = MIN_ZOOM_RATIO;

function getRequiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Image lightbox element not found: ${selector}`);
  }
  return element;
}

function normalizeImageSource(value: string | null | undefined) {
  const source = value?.trim();
  if (!source) return "";

  try {
    const url = new URL(source, document.baseURI);
    return ["http:", "https:", "data:", "blob:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function getImageSources(image: HTMLImageElement) {
  return [
    image.dataset.fullsize,
    image.dataset.original,
    image.dataset.src,
    image.getAttribute("src"),
    image.currentSrc,
  ]
    .map(normalizeImageSource)
    .filter(Boolean);
}

function isExplicitlyEnabled(element: Element) {
  return element.hasAttribute("data-image-preview") && element.getAttribute("data-image-preview") !== "false";
}

function isDirectImageLink(image: HTMLImageElement, anchor: HTMLAnchorElement) {
  const href = normalizeImageSource(anchor.getAttribute("href"));
  if (!href) return false;

  const hrefWithoutHash = href.split("#", 1)[0];
  const matchesImageSource = getImageSources(image).some((source) => source.split("#", 1)[0] === hrefWithoutHash);
  return matchesImageSource || IMAGE_URL_PATTERN.test(href);
}

function getLinkedAnchor(image: HTMLImageElement) {
  return image.closest<HTMLAnchorElement>("a[href]");
}

function canPreviewImage(image: HTMLImageElement) {
  if (image.matches(NON_PREVIEW_IMAGE_SELECTOR) || image.closest('[data-image-preview="false"]')) return false;
  if (getImageSources(image).length === 0) return false;

  const anchor = getLinkedAnchor(image);
  if (!anchor) return true;

  return isExplicitlyEnabled(image) || isExplicitlyEnabled(anchor) || isDirectImageLink(image, anchor);
}

function getFullSizeSource(image: HTMLImageElement) {
  const anchor = getLinkedAnchor(image);
  if (anchor && isDirectImageLink(image, anchor)) {
    const href = normalizeImageSource(anchor.getAttribute("href"));
    if (href) return href;
  }

  return getImageSources(image)[0] || "";
}

function getImageDetails(image: HTMLImageElement): ImageDetails {
  const figureCaption = image.closest("figure")?.querySelector("figcaption")?.textContent?.trim() || "";
  const displayName = image.dataset.displayName?.trim() || "";
  const alt = image.alt.trim();
  const title = displayName || figureCaption || alt;
  const description =
    image.dataset.description?.trim() ||
    (displayName && figureCaption !== displayName ? figureCaption : "") ||
    image.title.trim();

  return {
    src: getFullSizeSource(image),
    alt: alt || title || "预览图片",
    title,
    description,
  };
}

function updateZoomButton(scale: number) {
  if (!viewer) return;

  const isZoomed = scale > 1.01;
  viewer.zoomButton.setAttribute("aria-pressed", String(isZoomed));
  viewer.zoomButton.setAttribute("aria-label", isZoomed ? "还原图片大小" : "放大图片");
  viewer.zoomButton.title = `${isZoomed ? "还原图片大小" : "放大图片"}（Alt + 滚轮缩放）`;
}

function clampZoomRatio(scale: number) {
  return Math.min(MAX_ZOOM_RATIO, Math.max(MIN_ZOOM_RATIO, scale));
}

function getElementTranslate(element: HTMLElement) {
  const transform = window.getComputedStyle(element).transform;
  if (!transform || transform === "none") return { x: 0, y: 0 };

  try {
    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42 };
  } catch {
    return { x: 0, y: 0 };
  }
}

function setZoomRatio(scale: number, origin?: { clientX: number; clientY: number }, transitionDuration = 180) {
  if (!imageSwiper) return;

  const previousScale = imageSwiper.zoom.scale || MIN_ZOOM_RATIO;
  const nextScale = clampZoomRatio(scale);
  if (Math.abs(nextScale - previousScale) < 0.0001) return;

  const activeSlide = imageSwiper.slides[imageSwiper.activeIndex];
  const zoomContainer = activeSlide?.querySelector<HTMLElement>(".image-lightbox__zoom-container");
  const previewImage = activeSlide?.querySelector<HTMLImageElement>(".image-lightbox__image");
  if (!activeSlide || !zoomContainer || !previewImage) return;

  if (nextScale <= MIN_ZOOM_RATIO) {
    imageSwiper.zoom.out();
    zoomContainer.style.transitionDuration = `${transitionDuration}ms`;
    previewImage.style.transitionDuration = `${transitionDuration}ms`;
    return;
  }

  const slideRect = activeSlide.getBoundingClientRect();
  const currentTranslate = getElementTranslate(zoomContainer);
  const scaleChange = nextScale / previousScale;
  const originX = origin ? origin.clientX - (slideRect.left + slideRect.width / 2) : 0;
  const originY = origin ? origin.clientY - (slideRect.top + slideRect.height / 2) : 0;
  const maxTranslateX = Math.max((previewImage.offsetWidth * nextScale - activeSlide.clientWidth) / 2, 0);
  const maxTranslateY = Math.max((previewImage.offsetHeight * nextScale - activeSlide.clientHeight) / 2, 0);
  const translateX = Math.max(
    -maxTranslateX,
    Math.min(maxTranslateX, currentTranslate.x * scaleChange + originX * (1 - scaleChange)),
  );
  const translateY = Math.max(
    -maxTranslateY,
    Math.min(maxTranslateY, currentTranslate.y * scaleChange + originY * (1 - scaleChange)),
  );

  imageSwiper.zoom.in(nextScale);
  zoomContainer.style.transitionDuration = `${transitionDuration}ms`;
  zoomContainer.style.transform = `translate3d(${translateX}px, ${translateY}px, 0)`;
  previewImage.style.transitionDuration = `${transitionDuration}ms`;
}

function changeZoomRatio(step: number, origin?: { clientX: number; clientY: number }) {
  if (!imageSwiper) return;
  setZoomRatio(imageSwiper.zoom.scale + step, origin);
}

function toggleZoom() {
  if (!imageSwiper) return;

  if (imageSwiper.zoom.scale > 1.01) {
    imageSwiper.zoom.out();
  } else {
    setZoomRatio(DEFAULT_ZOOM_RATIO);
  }
}

function handleViewerWheel(event: WheelEvent) {
  if (!viewer?.dialog.open || !imageSwiper) return;

  event.preventDefault();
  const target = event.target as Element | null;
  if (!target?.closest(".image-lightbox__swiper") || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

  // Chrome/Edge expose trackpad pinch as Ctrl + wheel. A regular mouse wheel
  // requires Alt so normal scrolling never changes the zoom accidentally.
  if (!event.altKey && !event.ctrlKey) return;

  const deltaMultiplier =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
  const normalizedDelta = event.deltaY * deltaMultiplier;
  if (normalizedDelta === 0) return;

  const nextScale = imageSwiper.zoom.scale * Math.exp(-normalizedDelta * WHEEL_ZOOM_SENSITIVITY);
  setZoomRatio(nextScale, event, 0);
}

type TrackpadGestureEvent = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

function handleTrackpadGestureStart(event: Event) {
  if (!viewer?.dialog.open || !imageSwiper) return;
  event.preventDefault();
  gestureStartZoomRatio = imageSwiper.zoom.scale;
}

function handleTrackpadGestureChange(event: Event) {
  if (!viewer?.dialog.open || !imageSwiper) return;

  const gestureEvent = event as TrackpadGestureEvent;
  if (typeof gestureEvent.scale !== "number") return;
  event.preventDefault();
  setZoomRatio(
    gestureStartZoomRatio * gestureEvent.scale,
    {
      clientX: gestureEvent.clientX ?? window.innerWidth / 2,
      clientY: gestureEvent.clientY ?? window.innerHeight / 2,
    },
    0,
  );
}

function createViewer() {
  const dialog = document.createElement("dialog");
  dialog.className = "image-lightbox";
  dialog.setAttribute("aria-label", "图片预览");
  dialog.innerHTML = `
    <button class="image-lightbox__button image-lightbox__close" type="button" aria-label="关闭图片预览">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18"></path>
      </svg>
    </button>
    <button class="image-lightbox__button image-lightbox__zoom" type="button" aria-label="放大图片" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <g class="image-lightbox__zoom-in-symbol">
          <path d="M9 4H6a2 2 0 0 0-2 2v3"></path>
          <path d="M15 4h3a2 2 0 0 1 2 2v3"></path>
          <path d="M20 15v3a2 2 0 0 1-2 2h-3"></path>
          <path d="M9 20H6a2 2 0 0 1-2-2v-3"></path>
        </g>
        <g class="image-lightbox__zoom-out-symbol">
          <path d="M9 4v3a2 2 0 0 1-2 2H4"></path>
          <path d="M20 9h-3a2 2 0 0 1-2-2V4"></path>
          <path d="M15 20v-3a2 2 0 0 1 2-2h3"></path>
          <path d="M4 15h3a2 2 0 0 1 2 2v3"></path>
        </g>
      </svg>
    </button>
    <button class="image-lightbox__button image-lightbox__previous" type="button" aria-label="查看上一张图片">
      <svg viewBox="0 0 1024 1024" aria-hidden="true">
        <path d="M684.29 799.276 393.929 513.019 684.29 226.762c37.685-37.153 38.003-97.625.707-134.384-37.297-36.758-98.646-36.435-136.331.718l-357.43 352.378-.451.468-.256.239c-18.357 18.092-27.581 41.929-27.743 65.902l-.018.934.018.948c.165 23.97 9.389 47.803 27.743 65.892l.255.239.452.468 357.43 352.378c37.685 37.153 99.034 37.476 136.331.718 37.297-36.758 36.979-97.231-.707-134.384Z"></path>
      </svg>
    </button>
    <div class="swiper image-lightbox__swiper">
      <div class="swiper-wrapper image-lightbox__wrapper"></div>
    </div>
    <div class="image-lightbox__status" role="status" aria-live="polite" hidden></div>
    <button class="image-lightbox__button image-lightbox__next" type="button" aria-label="查看下一张图片">
      <svg viewBox="0 0 1024 1024" aria-hidden="true">
        <path d="m803.758 514.017-.018-.933c-.162-23.974-9.386-47.811-27.743-65.903l-.256-.239-.451-.468L417.861 94.096c-37.685-37.153-99.034-37.476-136.331-.718-37.297 36.758-36.979 97.231.707 134.384l290.361 286.257-290.362 286.257c-37.685 37.153-38.004 97.625-.707 134.383 37.297 36.758 98.646 36.435 136.331-.718l357.43-352.378.451-.468.256-.239c18.354-18.089 27.578-41.922 27.743-65.892l.018-.947Z"></path>
      </svg>
    </button>
    <div class="image-lightbox__caption">
      <div class="image-lightbox__title"></div>
      <div class="image-lightbox__description"></div>
      <div class="image-lightbox__counter" aria-live="polite"></div>
    </div>
  `;
  document.body.appendChild(dialog);

  const elements: ViewerElements = {
    dialog,
    swiperContainer: getRequiredElement(dialog, ".image-lightbox__swiper"),
    wrapper: getRequiredElement(dialog, ".image-lightbox__wrapper"),
    status: getRequiredElement(dialog, ".image-lightbox__status"),
    closeButton: getRequiredElement(dialog, ".image-lightbox__close"),
    zoomButton: getRequiredElement(dialog, ".image-lightbox__zoom"),
    previousButton: getRequiredElement(dialog, ".image-lightbox__previous"),
    nextButton: getRequiredElement(dialog, ".image-lightbox__next"),
    caption: getRequiredElement(dialog, ".image-lightbox__caption"),
    title: getRequiredElement(dialog, ".image-lightbox__title"),
    description: getRequiredElement(dialog, ".image-lightbox__description"),
    counter: getRequiredElement(dialog, ".image-lightbox__counter"),
  };

  elements.closeButton.addEventListener("click", closeViewer);
  elements.zoomButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleZoom();
  });
  elements.previousButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showPreviousImage();
  });
  elements.nextButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showNextImage();
  });
  dialog.addEventListener("wheel", handleViewerWheel, { passive: false });
  dialog.addEventListener("gesturestart", handleTrackpadGestureStart, { passive: false });
  dialog.addEventListener("gesturechange", handleTrackpadGestureChange, { passive: false });

  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (
      target === dialog ||
      target.classList.contains("swiper-slide") ||
      target.classList.contains("swiper-zoom-container")
    ) {
      closeViewer();
    }
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeViewer();
  });

  dialog.addEventListener("close", resetViewer);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeViewer();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPreviousImage();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showNextImage();
    } else if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
      event.preventDefault();
      changeZoomRatio(ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") {
      event.preventDefault();
      changeZoomRatio(-ZOOM_STEP);
    } else if (event.key === "0" || event.code === "Numpad0") {
      event.preventDefault();
      imageSwiper?.zoom.out();
    }
  });

  return elements;
}

function getViewer() {
  viewer ??= createViewer();
  return viewer;
}

function getPreviewImage(index: number) {
  return viewer?.wrapper.children.item(index)?.querySelector<HTMLImageElement>(".image-lightbox__image") || null;
}

function syncLoadingState() {
  if (!viewer) return;

  const previewImage = getPreviewImage(activeIndex);
  if (!previewImage) {
    viewer.status.hidden = true;
    return;
  }

  if (!previewImage.complete) {
    viewer.status.textContent = "正在加载图片…";
    viewer.status.hidden = false;
    return;
  }

  if (previewImage.naturalWidth > 0) {
    previewImage.classList.add("is-ready");
    viewer.status.hidden = true;
  } else {
    previewImage.classList.remove("is-ready");
    viewer.status.textContent = "图片加载失败";
    viewer.status.hidden = false;
  }
}

function createSlides(images: HTMLImageElement[], initialIndex: number) {
  const elements = getViewer();
  const fragment = document.createDocumentFragment();

  images.forEach((sourceImage, index) => {
    const details = getImageDetails(sourceImage);
    const slide = document.createElement("div");
    const zoomContainer = document.createElement("div");
    const previewImage = new Image();

    slide.className = "swiper-slide image-lightbox__slide";
    zoomContainer.className = "swiper-zoom-container image-lightbox__zoom-container";
    zoomContainer.dataset.swiperZoom = "4";
    previewImage.className = "image-lightbox__image";
    previewImage.alt = details.alt;
    previewImage.decoding = "async";
    previewImage.draggable = false;
    previewImage.loading = Math.abs(index - initialIndex) <= 1 ? "eager" : "lazy";

    previewImage.addEventListener("load", () => {
      previewImage.classList.add("is-ready");
      if (index === activeIndex) syncLoadingState();
    });
    previewImage.addEventListener("error", () => {
      previewImage.classList.remove("is-ready");
      if (index === activeIndex) syncLoadingState();
    });
    previewImage.src = details.src;

    zoomContainer.appendChild(previewImage);
    slide.appendChild(zoomContainer);
    fragment.appendChild(slide);
  });

  elements.wrapper.replaceChildren(fragment);
}

function syncViewerState(swiper: Swiper) {
  const elements = getViewer();
  const sourceImage = activeImages[swiper.activeIndex];
  if (!sourceImage) return;

  activeIndex = swiper.activeIndex;
  const details = getImageDetails(sourceImage);

  elements.title.textContent = details.title;
  elements.title.hidden = !details.title;
  elements.description.textContent = details.description;
  elements.description.hidden = !details.description;
  elements.counter.textContent = activeImages.length > 1 ? `${activeIndex + 1} / ${activeImages.length}` : "";
  elements.counter.hidden = activeImages.length <= 1;
  elements.caption.hidden = !details.title && !details.description && activeImages.length <= 1;

  const hasMultipleImages = activeImages.length > 1;
  elements.previousButton.hidden = !hasMultipleImages;
  elements.nextButton.hidden = !hasMultipleImages;
  elements.previousButton.disabled = activeIndex <= 0;
  elements.nextButton.disabled = activeIndex >= activeImages.length - 1;

  updateZoomButton(swiper.zoom.scale);
  syncLoadingState();
}

function finishPreviousZoomReset(swiper: Swiper) {
  if (swiper.previousIndex === swiper.activeIndex) return;

  const previousSlide = swiper.slides[swiper.previousIndex];
  const zoomContainer = previousSlide?.querySelector<HTMLElement>(".image-lightbox__zoom-container");
  const previewImage = previousSlide?.querySelector<HTMLElement>(".image-lightbox__image");

  // Swiper resets the previous zoomed image after the slide transition. Its
  // default 300ms reset can otherwise remain visible when the image overflows
  // into the active slide, so complete that already-hidden reset immediately.
  if (zoomContainer) zoomContainer.style.transitionDuration = "0ms";
  if (previewImage) previewImage.style.transitionDuration = "0ms";
}

function destroySwiper() {
  if (imageSwiper && !imageSwiper.destroyed) {
    imageSwiper.destroy(true, true);
  }
  imageSwiper = null;
}

function openViewer(images: HTMLImageElement[], index: number, trigger: HTMLElement) {
  if (!images[index]) return;

  activeImages = images;
  activeIndex = index;
  lastTrigger = trigger;

  const elements = getViewer();
  destroySwiper();
  createSlides(images, index);
  elements.status.textContent = "正在加载图片…";
  elements.status.hidden = false;

  if (!elements.dialog.open) {
    elements.dialog.showModal();
    document.documentElement.classList.add("image-lightbox-open");
    disableScroll(document.body);
    scrollLocked = true;
  }

  imageSwiper = new Swiper(elements.swiperContainer, {
    modules: [Zoom],
    initialSlide: index,
    slidesPerView: 1,
    spaceBetween: 0,
    speed: 260,
    threshold: 8,
    resistanceRatio: 0.65,
    grabCursor: true,
    preventClicks: true,
    preventClicksPropagation: true,
    lazyPreloadPrevNext: 1,
    zoom: {
      minRatio: MIN_ZOOM_RATIO,
      maxRatio: MAX_ZOOM_RATIO,
      toggle: true,
    },
    on: {
      init: syncViewerState,
      slideChange: syncViewerState,
      transitionEnd: finishPreviousZoomReset,
      zoomChange: (_swiper, scale) => updateZoomButton(scale),
    },
  });

  syncViewerState(imageSwiper);
  requestAnimationFrame(() => elements.closeButton.focus({ preventScroll: true }));
}

function showPreviousImage() {
  imageSwiper?.slidePrev();
}

function showNextImage() {
  imageSwiper?.slideNext();
}

function closeViewer() {
  if (viewer?.dialog.open) {
    viewer.dialog.close();
  }
}

function resetViewer() {
  document.documentElement.classList.remove("image-lightbox-open");
  if (scrollLocked) {
    enableScroll(document.body);
    scrollLocked = false;
  }

  destroySwiper();
  if (viewer) {
    viewer.wrapper.replaceChildren();
    viewer.status.hidden = true;
    updateZoomButton(1);
  }

  activeImages = [];
  activeIndex = -1;
  gestureStartZoomRatio = MIN_ZOOM_RATIO;

  const trigger = lastTrigger;
  lastTrigger = null;
  trigger?.focus({ preventScroll: true });
}

function registerGallery(gallery: HTMLElement) {
  const imageSelector = gallery.dataset.imageGallery === EXPLICIT_GALLERY_VALUE ? "img[data-image-preview]" : "img";
  const images = Array.from(gallery.querySelectorAll<HTMLImageElement>(imageSelector)).filter(canPreviewImage);

  images.forEach((image, index) => {
    const anchor = getLinkedAnchor(image);
    const trigger = anchor || image;
    if (trigger.dataset.imagePreviewReady === "true") return;

    trigger.dataset.imagePreviewReady = "true";
    trigger.setAttribute("aria-haspopup", "dialog");
    image.classList.add("image-preview-trigger");

    if (!anchor) {
      if (!image.hasAttribute("tabindex")) image.tabIndex = 0;
      if (!image.hasAttribute("role")) image.setAttribute("role", "button");
      if (!image.hasAttribute("aria-label")) {
        const label = image.alt.trim();
        image.setAttribute("aria-label", label ? `查看大图：${label}` : "查看大图");
      }
    }

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openViewer(images, index, trigger);
    });

    if (!anchor) {
      image.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openViewer(images, index, image);
      });
    }
  });
}

export function initImageLightbox() {
  document.querySelectorAll<HTMLElement>(GALLERY_SELECTOR).forEach(registerGallery);
}
