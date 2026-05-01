// src/lib/scrollbar.ts
import { OverlayScrollbars, PartialOptions } from "overlayscrollbars";
import "overlayscrollbars/overlayscrollbars.css";

const instanceMap = new WeakMap<HTMLElement, any>();

// 滚动拦截处理器
let scrollBlockHandler: ((e: Event) => void) | null = null;
let keyBlockHandler: ((e: KeyboardEvent) => void) | null = null;

const DEFAULT_OPTIONS: PartialOptions = {
  scrollbars: {
    theme: "os-theme-dark",
    autoHide: "scroll",
    clickScroll: true,
  },
};

/**
 * 初始化滚动条
 */
export function initScrollbars() {
  document.querySelectorAll<HTMLElement>(".os-scroll").forEach((el) => {
    if (!instanceMap.has(el)) {
      const osInstance = OverlayScrollbars(el, DEFAULT_OPTIONS);
      instanceMap.set(el, osInstance);
    }
  });
}

/**
 * ✅ 禁用滚动：拦截抽屉之外的滚动事件（允许 .mobile-drawer 内部滚动）
 */
export function disableScroll(_element?: HTMLElement) {
  if (scrollBlockHandler) return; // 已经拦截中

  scrollBlockHandler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    // 如果事件来自抽屉内部，允许滚动
    if (target && target.closest && target.closest(".mobile-drawer")) {
      return;
    }
    // 其他地方的滚动被阻止
    e.preventDefault();
    e.stopPropagation();
  };

  // 同时拦截键盘导致的滚动（空格、PgUp/PgDn、方向键、Home/End）
  keyBlockHandler = (e: KeyboardEvent) => {
    const blockedKeys = [" ", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
    const target = e.target as HTMLElement | null;
    if (target && target.closest && target.closest(".mobile-drawer")) {
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

  const modalWrapper = shadowRoot.querySelector(".modal__wrapper");
  if (!modalWrapper) {
    console.warn("⚠️ 未找到 .modal__wrapper 元素");
    return;
  }

  // 初始状态检查
  const initialDisplay = getComputedStyle(modalWrapper).display;
  if (initialDisplay !== "none") {
    disableScroll(document.body);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.attributeName === "style") {
        const display = getComputedStyle(modalWrapper).display;
        if (display === "none") {
          enableScroll(document.body);
        } else {
          disableScroll(document.body);
        }
      }
    }
  });

  // 观察目标：style 属性变化
  observer.observe(modalWrapper, {
    attributes: true,
    attributeFilter: ["style"],
  });

  // 返回一个清理函数（可选）
  return () => observer.disconnect();
}
