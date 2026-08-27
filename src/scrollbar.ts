// src/lib/scrollbar.ts
import { OverlayScrollbars, PartialOptions, ScrollbarsHidingPlugin } from "overlayscrollbars";
import "overlayscrollbars/overlayscrollbars.css";

const LIGHT_MODE_SCROLLBAR_THEME = "os-theme-dark";
const DARK_MODE_SCROLLBAR_THEME = "os-theme-light";
const AUTO_HIDE_DELAY = 1300;
const AUTO_HIDE_HIDDEN_CLASS = "os-scrollbar-auto-hide-hidden";

const instanceMap = new Map<HTMLElement, ReturnType<typeof OverlayScrollbars>>();
const autoHideCleanupMap = new Map<HTMLElement, () => void>();
let themeObserver: MutationObserver | null = null;

OverlayScrollbars.plugin(ScrollbarsHidingPlugin);

// 滚动拦截处理器
let scrollBlockHandler: ((e: Event) => void) | null = null;
let keyBlockHandler: ((e: KeyboardEvent) => void) | null = null;

function getScrollbarTheme() {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark") || root.getAttribute("data-color-mode") === "dark";
  return isDark ? DARK_MODE_SCROLLBAR_THEME : LIGHT_MODE_SCROLLBAR_THEME;
}

function shouldAutoHideScrollbars() {
  return document.documentElement.getAttribute("data-scrollbar-auto-hide") !== "false";
}

function getScrollbarOptions(theme = getScrollbarTheme()): PartialOptions {
  return {
    scrollbars: {
      theme,
      visibility: "visible",
      autoHide: shouldAutoHideScrollbars() ? "scroll" : "never",
      clickScroll: false,
    },
    showNativeOverlaidScrollbars: false,
  };
}

function setupScrollbarAutoHide(element: HTMLElement, instance: ReturnType<typeof OverlayScrollbars>) {
  if (!shouldAutoHideScrollbars()) return;

  const { scrollEventElement, scrollbarHorizontal, scrollbarVertical } = instance.elements();
  const scrollbars = [scrollbarHorizontal.scrollbar, scrollbarVertical.scrollbar];
  const scrollEventTargets: EventTarget[] =
    element === document.body ? [scrollEventElement, window] : [scrollEventElement];
  let hideTimer: number | undefined;

  const setHidden = (hidden: boolean) => {
    scrollbars.forEach((scrollbar) => {
      scrollbar.classList.toggle(AUTO_HIDE_HIDDEN_CLASS, hidden);
    });
  };

  const showAndScheduleHide = () => {
    window.clearTimeout(hideTimer);
    setHidden(false);
    hideTimer = window.setTimeout(() => setHidden(true), AUTO_HIDE_DELAY);
  };

  scrollEventTargets.forEach((target) => {
    target.addEventListener("scroll", showAndScheduleHide, { passive: true });
  });
  showAndScheduleHide();

  autoHideCleanupMap.set(element, () => {
    window.clearTimeout(hideTimer);
    scrollEventTargets.forEach((target) => {
      target.removeEventListener("scroll", showAndScheduleHide);
    });
  });
}

/**
 * 初始化滚动条
 */
export function initScrollbars() {
  const theme = getScrollbarTheme();
  document.querySelectorAll<HTMLElement>(".os-scroll").forEach((el) => {
    if (!instanceMap.has(el)) {
      const osInstance =
        el === document.body
          ? OverlayScrollbars(
              {
                target: el,
                cancel: {
                  nativeScrollbarsOverlaid: false,
                  body: false,
                },
              },
              getScrollbarOptions(theme),
            )
          : OverlayScrollbars(el, getScrollbarOptions(theme));
      instanceMap.set(el, osInstance);
      setupScrollbarAutoHide(el, osInstance);
    }
  });

  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      syncScrollbarThemes();
    });

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-color-mode"],
    });
  }
}

function syncScrollbarThemes() {
  const theme = getScrollbarTheme();
  instanceMap.forEach((instance) => {
    instance.options({
      scrollbars: {
        ...instance.options().scrollbars,
        theme,
      },
    });
  });
}

/**
 * ✅ 禁用滚动：拦截遮罩之外的滚动事件（允许抽屉和图片查看器处理自身手势）
 */
export function disableScroll(_element?: HTMLElement) {
  if (scrollBlockHandler) return; // 已经拦截中

  scrollBlockHandler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest) {
      // 抽屉允许自身滚动；图片查看器自行处理触摸与滚轮缩放并阻止页面穿透。
      if (target.closest(".mobile-drawer")) return;
      if (target.closest(".image-lightbox")) return;
    }
    // 其他地方的滚动被阻止
    e.preventDefault();
    e.stopPropagation();
  };

  // 同时拦截键盘导致的滚动（空格、PgUp/PgDn、方向键、Home/End）
  keyBlockHandler = (e: KeyboardEvent) => {
    const blockedKeys = [" ", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
    const target = e.target as HTMLElement | null;
    if (target && target.closest && target.closest(".mobile-drawer, .image-lightbox")) {
      return;
    }
    if (blockedKeys.includes(e.key)) {
      e.preventDefault();
    }
  };

  document.addEventListener("wheel", scrollBlockHandler, { passive: false, capture: true });
  document.addEventListener("touchmove", scrollBlockHandler, { passive: false, capture: true });
  document.addEventListener("keydown", keyBlockHandler, { capture: true });
}

/**
 * ✅ 恢复滚动：移除滚动拦截器
 */
export function enableScroll(_element?: HTMLElement) {
  if (scrollBlockHandler) {
    document.removeEventListener("wheel", scrollBlockHandler, { capture: true } as any);
    document.removeEventListener("touchmove", scrollBlockHandler, { capture: true } as any);
    scrollBlockHandler = null;
  }
  if (keyBlockHandler) {
    document.removeEventListener("keydown", keyBlockHandler, { capture: true } as any);
    keyBlockHandler = null;
  }
}

/**
 * 销毁（可选）
 */
export function destroyScrollbar(element: HTMLElement) {
  const instance = instanceMap.get(element);
  if (instance) {
    autoHideCleanupMap.get(element)?.();
    autoHideCleanupMap.delete(element);
    instance.destroy();
    instanceMap.delete(element);
  }
}

/**
 * 监听 .modal__wrapper 的 display 变化，自动控制 body 滚动
 */
export function watchModalAndControlBodyScroll() {
  const searchModal = document.querySelector("search-modal");
  if (!searchModal) {
    console.warn("⚠️ 未找到 <search-modal> 元素");
    return;
  }

  const shadowRoot = searchModal.shadowRoot;
  if (!shadowRoot) {
    console.warn("⚠️ <search-modal> 没有 shadow root");
    return;
  }

  const modalWrapper = shadowRoot.querySelector<HTMLElement>(".modal__wrapper");
  if (!modalWrapper) {
    console.warn("⚠️ 未找到 .modal__wrapper 元素");
    return;
  }

  // 页面滚动后，body 上的 OverlayScrollbars 会让 sticky 顶栏离开视口。
  // 搜索打开时将顶栏平移回视口顶部，但仍让它处于全屏遮罩下方：
  // 顶栏保持可见但不可交互，搜索内容则避开顶栏显示。
  const header = document.getElementById("header");
  const originalHeaderTranslate = header
    ? {
        value: header.style.getPropertyValue("translate"),
        priority: header.style.getPropertyPriority("translate"),
      }
    : null;
  let isHeaderPinned = false;
  let headerTranslateY = 0;

  const restoreHeaderTranslate = () => {
    if (!header) return;
    if (originalHeaderTranslate?.value) {
      header.style.setProperty("translate", originalHeaderTranslate.value, originalHeaderTranslate.priority);
    } else {
      header.style.removeProperty("translate");
    }
  };

  const keepHeaderInViewport = () => {
    if (!header || !isHeaderPinned) return;

    const currentTop = header.getBoundingClientRect().top;
    if (Math.abs(currentTop) < 0.5) return;

    headerTranslateY -= currentTop;
    header.style.setProperty("translate", `0 ${headerTranslateY}px`);
  };

  const setHeaderPinned = (pinned: boolean) => {
    if (!header || pinned === isHeaderPinned) return;

    isHeaderPinned = pinned;
    if (pinned) {
      headerTranslateY = -header.getBoundingClientRect().top;
      header.style.setProperty("translate", `0 ${headerTranslateY}px`);
      return;
    }

    headerTranslateY = 0;
    restoreHeaderTranslate();
  };

  const syncModalLayout = () => {
    const headerHeight = header ? Math.max(0, Math.round(header.getBoundingClientRect().height)) : 0;
    modalWrapper.style.top = "0px";
    modalWrapper.style.height = "100%";
    modalWrapper.style.paddingTop = `calc(3em + ${headerHeight}px)`;
  };
  syncModalLayout();

  let headerResizeObserver: ResizeObserver | null = null;
  if (header && typeof ResizeObserver !== "undefined") {
    headerResizeObserver = new ResizeObserver(() => {
      keepHeaderInViewport();
      syncModalLayout();
    });
    headerResizeObserver.observe(header);
  }

  const updateModalState = () => {
    const isOpen = getComputedStyle(modalWrapper).display !== "none";
    setHeaderPinned(isOpen);
    if (isOpen) {
      keepHeaderInViewport();
      syncModalLayout();
      disableScroll(document.body);
    } else {
      enableScroll(document.body);
    }
  };

  // 初始状态检查
  updateModalState();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.attributeName === "style") {
        updateModalState();
      }
    }
  });

  // 观察目标：style 属性变化
  observer.observe(modalWrapper, {
    attributes: true,
    attributeFilter: ["style"],
  });

  window.addEventListener("scroll", keepHeaderInViewport, { passive: true });

  // 返回一个清理函数（可选）
  return () => {
    observer.disconnect();
    headerResizeObserver?.disconnect();
    window.removeEventListener("scroll", keepHeaderInViewport);
    setHeaderPinned(false);
  };
}
