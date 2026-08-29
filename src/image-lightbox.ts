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
const ZOOM_TRANSITION_DURATION = 240;
const BOUNCE_RETURN_DURATION = 360;
const BOUNCE_AXIS_THRESHOLD = 6;
const SWIPE_GESTURE_THRESHOLD = 8;
const SWIPER_SETTLE_EPSILON = 1;
const BACKDROP_CLICK_SUPPRESSION_DURATION = 400;

type BounceGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  axis: "pending" | "horizontal" | "vertical";
  layer: HTMLElement;
};

type ViewerPointerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type SwiperTouchLock = {
  swiper: Swiper;
  allowTouchMove: boolean;
  allowSlidePrevious: boolean;
  allowSlideNext: boolean;
};

type TouchGestureMode = "idle" | "swiper" | "pinch";

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
let bounceGesture: BounceGesture | null = null;
let bounceCleanupTimer: number | undefined;
let viewerPointerGesture: ViewerPointerGesture | null = null;
let backdropClickSuppressedUntil = 0;
const activeTouchPointers = new Set<number>();
const blockedTouchPointers = new Set<number>();
let swiperTouchLock: SwiperTouchLock | null = null;
let touchGestureMode: TouchGestureMode = "idle";
let swiperSlideDragging = false;
let swiperSlideTransitioning = false;
let blockAllTouchMovesUntilRelease = false;

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
  viewer.dialog.classList.toggle("is-image-zoomed", isZoomed);
  viewer.zoomButton.setAttribute("aria-pressed", String(isZoomed));
  viewer.zoomButton.setAttribute("aria-label", isZoomed ? "还原图片大小" : "放大图片");
  viewer.zoomButton.title = isZoomed ? "还原图片大小（也可双击图片）" : "放大图片（也可双击图片，或按 Alt + 滚轮缩放）";
}

function clampZoomRatio(scale: number) {
  return Math.min(MAX_ZOOM_RATIO, Math.max(MIN_ZOOM_RATIO, scale));
}

function getRubberBandDistance(distance: number, viewportSize: number) {
  const absoluteDistance = Math.abs(distance);
  const maxDistance = Math.min(96, viewportSize * 0.12);
  const resistedDistance = (absoluteDistance * 0.38 * viewportSize) / (viewportSize + absoluteDistance * 0.38);
  return Math.sign(distance) * Math.min(maxDistance, resistedDistance);
}

function resetBounceLayer(layer: HTMLElement, animate = true) {
  window.clearTimeout(bounceCleanupTimer);
  layer.style.transitionDuration = animate ? `${BOUNCE_RETURN_DURATION}ms` : "0ms";
  layer.style.transform = "translate3d(0, 0, 0)";
  layer.classList.toggle("is-rebounding", animate);

  if (animate) {
    bounceCleanupTimer = window.setTimeout(() => {
      layer.classList.remove("is-rebounding");
      layer.style.removeProperty("transition-duration");
    }, BOUNCE_RETURN_DURATION);
  }
}

function cancelBounceGesture(animate = true) {
  if (!bounceGesture) return;
  resetBounceLayer(bounceGesture.layer, animate && bounceGesture.axis === "vertical");
  bounceGesture = null;
}

function handleBouncePointerDown(event: PointerEvent) {
  if (!imageSwiper || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;

  // 放大状态由 Swiper Zoom 自己处理四向拖拽与越界阻尼；这里补足原始尺寸下缺失的纵向回弹。
  if (imageSwiper.zoom.scale > 1.01) {
    cancelBounceGesture(false);
    return;
  }

  const target = event.target as Element | null;
  const slide = target?.closest<HTMLElement>(".image-lightbox__slide.swiper-slide-active");
  const layer = slide?.querySelector<HTMLElement>(".image-lightbox__bounce-layer");
  if (!slide || !layer) return;

  resetBounceLayer(layer, false);
  bounceGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    axis: "pending",
    layer,
  };
}

function handleBouncePointerMove(event: PointerEvent) {
  if (!imageSwiper || !bounceGesture || bounceGesture.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - bounceGesture.startX;
  const deltaY = event.clientY - bounceGesture.startY;

  if (bounceGesture.axis === "pending") {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < BOUNCE_AXIS_THRESHOLD) return;
    bounceGesture.axis = Math.abs(deltaY) > Math.abs(deltaX) ? "vertical" : "horizontal";
  }

  // 横向继续交给相册本身处理切图与首尾回弹，纵向移动独立的弹性层。
  if (bounceGesture.axis !== "vertical") return;

  event.preventDefault();
  imageSwiper.allowClick = false;
  const viewportHeight = bounceGesture.layer.parentElement?.clientHeight || window.innerHeight;
  const translateY = getRubberBandDistance(deltaY, viewportHeight);
  bounceGesture.layer.style.transitionDuration = "0ms";
  bounceGesture.layer.style.transform = `translate3d(0, ${translateY}px, 0)`;
}

function handleBouncePointerEnd(event: PointerEvent) {
  if (!bounceGesture || bounceGesture.pointerId !== event.pointerId) return;
  cancelBounceGesture(true);
}

function releaseSwiperTouchLock() {
  if (!swiperTouchLock) return;

  const lock = swiperTouchLock;
  if (!lock.swiper.destroyed) {
    lock.swiper.allowTouchMove = lock.allowTouchMove;
    lock.swiper.allowSlidePrev = lock.allowSlidePrevious;
    lock.swiper.allowSlideNext = lock.allowSlideNext;
  }
  swiperTouchLock = null;
}

function resetTouchGestureWhenReleased() {
  if (activeTouchPointers.size > 0 || blockAllTouchMovesUntilRelease) return;

  releaseSwiperTouchLock();
  blockedTouchPointers.clear();
  touchGestureMode = "idle";
  swiperSlideDragging = false;
}

function isSwiperBetweenSlides(swiper: Swiper) {
  const currentTranslate = Math.abs(swiper.getTranslate());
  if (!Number.isFinite(currentTranslate)) return false;

  return !swiper.snapGrid.some(
    (snapPoint) => Math.abs(currentTranslate - Math.abs(snapPoint)) <= SWIPER_SETTLE_EPSILON,
  );
}

function isSwiperGestureInProgress(swiper: Swiper) {
  return (
    touchGestureMode === "swiper" ||
    swiperSlideDragging ||
    swiperSlideTransitioning ||
    swiper.animating ||
    isSwiperBetweenSlides(swiper)
  );
}

function lockSwiperForPinch(swiper: Swiper) {
  if (swiperTouchLock) return;

  swiperTouchLock = {
    swiper,
    allowTouchMove: swiper.allowTouchMove,
    allowSlidePrevious: swiper.allowSlidePrev,
    allowSlideNext: swiper.allowSlideNext,
  };
  swiper.allowTouchMove = false;
  swiper.allowSlidePrev = false;
  swiper.allowSlideNext = false;
  cancelBounceGesture(false);
}

function blockTouchPointer(event: PointerEvent) {
  blockedTouchPointers.add(event.pointerId);
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
}

function handleTouchPointerDownCapture(event: PointerEvent) {
  if (event.pointerType !== "touch" || !imageSwiper) return;

  const target = event.target as Element | null;
  if (!target?.closest(".image-lightbox__swiper")) return;

  const isAdditionalTouch = activeTouchPointers.size > 0;
  activeTouchPointers.add(event.pointerId);
  if (!isAdditionalTouch) return;

  // Swiper 已经开始横向位移后，不允许第二根手指中途把当前手势
  // 转换成 Zoom 捏合；否则 Zoom 会在两张正错位的 slide 上建立缩放状态。
  if (isSwiperGestureInProgress(imageSwiper)) {
    touchGestureMode = "swiper";
    blockTouchPointer(event);
    return;
  }

  // Zoom 只需要两根手指。第三根及后续手指也隔离到本轮触摸结束，
  // 避免改变 Swiper Zoom 内部缓存的两点组合。
  if (touchGestureMode === "pinch" || activeTouchPointers.size > 2) {
    blockTouchPointer(event);
    return;
  }

  touchGestureMode = "pinch";
  lockSwiperForPinch(imageSwiper);
}

function handleTouchPointerMoveCapture(event: PointerEvent) {
  if (event.pointerType !== "touch") return;

  if (blockAllTouchMovesUntilRelease || blockedTouchPointers.has(event.pointerId)) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    return;
  }

  // 不再只等 Swiper 的 sliderFirstMove。真机上 Pointer Events 与 Touch
  // Events 的组合顺序可能不同，因此在查看器捕获阶段先自行确认横向意图。
  if (
    imageSwiper &&
    touchGestureMode === "idle" &&
    activeTouchPointers.size === 1 &&
    imageSwiper.zoom.scale <= 1.01 &&
    viewerPointerGesture?.pointerId === event.pointerId
  ) {
    const deltaX = event.clientX - viewerPointerGesture.startX;
    const deltaY = event.clientY - viewerPointerGesture.startY;
    if (Math.abs(deltaX) >= SWIPE_GESTURE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
      touchGestureMode = "swiper";
      swiperSlideDragging = true;
    }
  }
}

function handleTouchPointerEndCapture(event: PointerEvent) {
  if (event.pointerType !== "touch" || !blockedTouchPointers.has(event.pointerId)) return;

  blockedTouchPointers.delete(event.pointerId);
  activeTouchPointers.delete(event.pointerId);
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
  resetTouchGestureWhenReleased();
}

function handleTouchStartCapture(event: TouchEvent) {
  if (!imageSwiper || event.touches.length < 2) return;

  const target = event.target as Element | null;
  if (!target?.closest(".image-lightbox__swiper")) return;

  // Pointer 捕获已经拦住第二指时，这里只补充阻止浏览器原生捏合。
  if (blockedTouchPointers.size > 0) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    return;
  }

  // 某些移动端 WebView 会先让 Touch Events 推动 Swiper，再补齐多指
  // Pointer Events。直接检查 wrapper 的实时位移，堵住这个时序缺口。
  if (!isSwiperGestureInProgress(imageSwiper)) return;

  touchGestureMode = "swiper";
  blockAllTouchMovesUntilRelease = true;
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
}

function handleTouchMoveCapture(event: TouchEvent) {
  if (!blockAllTouchMovesUntilRelease) return;
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
}

function handleTouchEndCapture(event: TouchEvent) {
  if (event.touches.length > 0) return;

  blockAllTouchMovesUntilRelease = false;
  activeTouchPointers.clear();
  blockedTouchPointers.clear();
  resetTouchGestureWhenReleased();
}

function handleViewerPointerDown(event: PointerEvent) {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;

  viewerPointerGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
}

function handleViewerPointerMove(event: PointerEvent) {
  if (!viewerPointerGesture || viewerPointerGesture.pointerId !== event.pointerId) return;

  const distance = Math.hypot(event.clientX - viewerPointerGesture.startX, event.clientY - viewerPointerGesture.startY);
  if (distance < BOUNCE_AXIS_THRESHOLD) return;

  viewerPointerGesture.moved = true;
  backdropClickSuppressedUntil = performance.now() + BACKDROP_CLICK_SUPPRESSION_DURATION;
}

function handleViewerPointerEnd(event: PointerEvent) {
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    // 一次捏合开始后保持切图锁，直到所有手指都抬起，避免剩下的一根
    // 手指继续移动时又被 Swiper 当成新的横向滑动。
    resetTouchGestureWhenReleased();
  }

  if (!viewerPointerGesture || viewerPointerGesture.pointerId !== event.pointerId) return;

  if (viewerPointerGesture.moved) {
    backdropClickSuppressedUntil = performance.now() + BACKDROP_CLICK_SUPPRESSION_DURATION;
  }
  viewerPointerGesture = null;
}

function setZoomRatio(
  scale: number,
  origin?: MouseEvent | TouchEvent | PointerEvent,
  transitionDuration = ZOOM_TRANSITION_DURATION,
) {
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

  // 缩放比例与位移都交给 Swiper Zoom 维护。外部再写 zoomContainer.transform
  // 会让 DOM 位移与 Swiper 的 currentX/currentY 脱节，第二次捏合时就容易跳位。
  if (previousScale <= MIN_ZOOM_RATIO) {
    // Swiper 14 从 1 倍直接调用 zoom.in(指定倍率) 时，会把缺失的触点
    // 坐标当成左上角并产生极限位移。先用真实交互位置建立完整的 4 倍
    // 内部状态，再收敛到目标倍率，位移和 currentX/currentY 会保持一致。
    imageSwiper.zoom.toggle(origin);
  }
  if (Math.abs(imageSwiper.zoom.scale - nextScale) >= 0.0001) {
    imageSwiper.zoom.in(nextScale);
  }
  zoomContainer.style.transitionDuration = `${transitionDuration}ms`;
  previewImage.style.transitionDuration = `${transitionDuration}ms`;
}

function changeZoomRatio(step: number) {
  if (!imageSwiper) return;
  setZoomRatio(imageSwiper.zoom.scale + step);
}

function toggleZoom(origin?: MouseEvent | TouchEvent | PointerEvent) {
  if (!imageSwiper) return;

  if (imageSwiper.zoom.scale > 1.01) {
    setZoomRatio(MIN_ZOOM_RATIO, origin);
  } else {
    setZoomRatio(DEFAULT_ZOOM_RATIO, origin);
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
};

function handleTrackpadGestureStart(event: Event) {
  // iOS 同时派发旧式 gesture* 与 Pointer Events；后者已由 Swiper Zoom
  // 完整接管。两套处理器同时更新比例会造成第二次捏合时位移状态错乱。
  if (!viewer?.dialog.open || !imageSwiper) return;
  event.preventDefault();
  if (navigator.maxTouchPoints > 0) return;
  gestureStartZoomRatio = imageSwiper.zoom.scale;
}

function handleTrackpadGestureChange(event: Event) {
  if (!viewer?.dialog.open || !imageSwiper) return;
  event.preventDefault();
  if (navigator.maxTouchPoints > 0) return;

  const gestureEvent = event as TrackpadGestureEvent;
  if (typeof gestureEvent.scale !== "number") return;
  setZoomRatio(gestureStartZoomRatio * gestureEvent.scale, undefined, 0);
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
        <g transform="translate(1.125 1.125)">
          <circle cx="10.5" cy="10.5" r="7"></circle>
          <path d="m15.5 15.5 2.75 2.75"></path>
          <path class="image-lightbox__zoom-in-symbol" d="M7.5 10.5h6M10.5 7.5v6"></path>
          <path class="image-lightbox__zoom-out-symbol" d="M7.5 10.5h6"></path>
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
  dialog.addEventListener("touchstart", handleTouchStartCapture, { capture: true, passive: false });
  dialog.addEventListener("touchmove", handleTouchMoveCapture, { capture: true, passive: false });
  dialog.addEventListener("touchend", handleTouchEndCapture, { capture: true });
  dialog.addEventListener("touchcancel", handleTouchEndCapture, { capture: true });
  // 必须先于 Swiper wrapper 上的 Zoom 监听器执行，才能让“切图中落下的
  // 第二根手指”完全不进入 Zoom 的指针缓存。
  dialog.addEventListener("pointerdown", handleTouchPointerDownCapture, { capture: true });
  dialog.addEventListener("pointermove", handleTouchPointerMoveCapture, { capture: true, passive: false });
  dialog.addEventListener("pointerup", handleTouchPointerEndCapture, { capture: true });
  dialog.addEventListener("pointercancel", handleTouchPointerEndCapture, { capture: true });
  dialog.addEventListener("pointerdown", handleViewerPointerDown);
  dialog.addEventListener("pointerdown", handleBouncePointerDown);
  dialog.addEventListener("pointermove", handleViewerPointerMove);
  dialog.addEventListener("pointermove", handleBouncePointerMove, { passive: false });
  dialog.addEventListener("pointerup", handleViewerPointerEnd);
  dialog.addEventListener("pointerup", handleBouncePointerEnd);
  dialog.addEventListener("pointercancel", handleViewerPointerEnd);
  dialog.addEventListener("pointercancel", handleBouncePointerEnd);

  dialog.addEventListener("click", (event) => {
    if (event.defaultPrevented || performance.now() < backdropClickSuppressedUntil) return;

    const target = event.target as Element | null;
    if (!target) return;

    // 图片与交互控件保持可操作；其余区域（包括缩放容器中的黑色留白）都视为关闭区域。
    if (target.closest(".image-lightbox__image.is-ready, .image-lightbox__button, .image-lightbox__caption")) return;
    closeViewer();
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
      setZoomRatio(MIN_ZOOM_RATIO);
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
    const bounceLayer = document.createElement("div");
    const zoomContainer = document.createElement("div");
    const previewImage = new Image();

    slide.className = "swiper-slide image-lightbox__slide";
    bounceLayer.className = "image-lightbox__bounce-layer";
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
    bounceLayer.appendChild(zoomContainer);
    slide.appendChild(bounceLayer);
    fragment.appendChild(slide);
  });

  elements.wrapper.replaceChildren(fragment);
}

function syncViewerState(swiper: Swiper) {
  cancelBounceGesture(false);
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

function handleSlideChange(swiper: Swiper) {
  cancelBounceGesture(false);

  if (swiper.previousIndex !== swiper.activeIndex && swiper.zoom.enabled) {
    // Swiper Zoom 默认到 transitionEnd 才释放上一张图片。切图时立即清理，
    // 让新激活的 slide 无需等待动画结束即可重新接收双指缩放。
    swiper.zoom.out();

    const previousSlide = swiper.slides[swiper.previousIndex];
    const zoomContainer = previousSlide?.querySelector<HTMLElement>(".image-lightbox__zoom-container");
    const previewImage = previousSlide?.querySelector<HTMLElement>(".image-lightbox__image");
    if (zoomContainer) zoomContainer.style.transitionDuration = "0ms";
    if (previewImage) previewImage.style.transitionDuration = "0ms";
  }

  syncViewerState(swiper);
}

function handleSwiperSliderFirstMove() {
  if (swiperTouchLock) return;

  swiperSlideDragging = true;
  touchGestureMode = "swiper";
}

function handleSwiperTouchEnd() {
  swiperSlideDragging = false;
  resetTouchGestureWhenReleased();
}

function handleSwiperTransitionStart() {
  swiperSlideTransitioning = true;
}

function handleSwiperTransitionEnd(swiper: Swiper) {
  swiperSlideTransitioning = false;
  finishPreviousZoomReset(swiper);
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
  cancelBounceGesture(false);
  window.clearTimeout(bounceCleanupTimer);
  activeTouchPointers.clear();
  blockedTouchPointers.clear();
  releaseSwiperTouchLock();
  touchGestureMode = "idle";
  swiperSlideDragging = false;
  swiperSlideTransitioning = false;
  blockAllTouchMovesUntilRelease = false;
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
    resistance: true,
    resistanceRatio: 0.82,
    touchReleaseOnEdges: false,
    watchOverflow: false,
    grabCursor: true,
    preventClicks: true,
    preventClicksPropagation: true,
    lazyPreloadPrevNext: 1,
    zoom: {
      minRatio: MIN_ZOOM_RATIO,
      maxRatio: MAX_ZOOM_RATIO,
      // 自己接管双击，保证移动端放大、还原走同一套比例和过渡逻辑。
      toggle: false,
    },
    on: {
      init: syncViewerState,
      slideChange: handleSlideChange,
      sliderFirstMove: handleSwiperSliderFirstMove,
      touchEnd: handleSwiperTouchEnd,
      transitionStart: handleSwiperTransitionStart,
      transitionEnd: handleSwiperTransitionEnd,
      zoomChange: (_swiper, scale) => {
        updateZoomButton(scale);
        if (scale > 1.01) cancelBounceGesture(false);
      },
      doubleTap: (_swiper, event) => {
        event.preventDefault();
        event.stopPropagation();
        // 双击采用居中放大，避免不同浏览器对事件坐标换算不一致而产生上偏。
        toggleZoom();
      },
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
  viewerPointerGesture = null;
  backdropClickSuppressedUntil = 0;

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
