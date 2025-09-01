// src/lib/scrollbar.ts
import { OverlayScrollbars, PartialOptions } from "overlayscrollbars";
import "overlayscrollbars/overlayscrollbars.css";

const instanceMap = new WeakMap<HTMLElement, any>();

// 存储备用样式
const originalOverflow = new WeakMap<HTMLElement, string>();

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
 * ✅ 真正禁用滚动：销毁 + overflow: hidden
 */
export function disableScroll(element: HTMLElement) {
  const instance = instanceMap.get(element);

  // 1. 存原始 overflow
  if (!originalOverflow.has(element)) {
    originalOverflow.set(element, element.style.overflow || "");
  }

  // 2. 销毁实例（移除所有事件）
  if (instance) {
    instance.destroy();
    instanceMap.delete(element);
  }

  // 3. 强制禁止滚动
  element.style.overflow = "hidden";
  console.log("✅ 滚动已禁用:", element);
}

/**
 * ✅ 恢复滚动：恢复样式 + 重新初始化
 */
export function enableScroll(element: HTMLElement) {
  // 1. 先销毁（如果已存在）
  if (instanceMap.has(element)) {
    instanceMap.get(element).destroy();
    instanceMap.delete(element);
  }

  // 2. 恢复原始 overflow
  const original = originalOverflow.get(element);

  element.style.overflow = original === "hidden" ? "" : original || "";

  // 3. 重新初始化
  const osInstance = OverlayScrollbars(element, DEFAULT_OPTIONS);
  instanceMap.set(element, osInstance);

  console.log("✅ 滚动已恢复:", element);
}

/**
 * 销毁（可选）
 */
export function destroyScrollbar(element: HTMLElement) {
  const instance = instanceMap.get(element);
  if (instance) {
    instance.destroy();
    instanceMap.delete(element);
    originalOverflow.delete(element);
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
