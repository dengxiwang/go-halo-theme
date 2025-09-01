import Alpine from "alpinejs";
import "github-markdown-css/github-markdown-light.css";
import Swiper from "swiper";
import "swiper/css";
import "swiper/css/autoplay";
import { Autoplay } from "swiper/modules";
import * as tocbot from "tocbot";
import { disableScroll, enableScroll, initScrollbars, watchModalAndControlBodyScroll } from "./scrollbar";
import "./styles/main.css";
import "./styles/tailwind.css";

// 页面加载后初始化
document.addEventListener("DOMContentLoaded", () => {
  initScrollbars();
  watchModalAndControlBodyScroll();
});

(window as any).disableScroll = disableScroll;
(window as any).enableScroll = enableScroll;

window.Alpine = Alpine;

Alpine.start();

document.addEventListener("DOMContentLoaded", () => {
  const el = document.querySelector(".moment-swiper") as any;
  if (el) {
    new Swiper(el, {
      direction: "vertical",
      loop: true,
      autoplay: { delay: 3000 },
      modules: [Autoplay],
    });
  }
});

// 禁止浏览器自动恢复滚动位置
if (window.history && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

// 页面加载时滚动到顶部
function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(scrollToTop);
  });
} else {
  requestAnimationFrame(scrollToTop);
}

const btnScrollToTop = document.getElementById("btn-scroll-to-top") as HTMLDivElement;

// 监听滚动事件，控制按钮显示/隐藏
window.addEventListener("scroll", () => {
  if (window.scrollY > 300) {
    btnScrollToTop.classList.remove("opacity-0", "pointer-events-none");
    btnScrollToTop.classList.add("opacity-50", "pointer-events-auto");
  } else {
    btnScrollToTop.classList.remove("opacity-50", "pointer-events-auto");
    btnScrollToTop.classList.add("opacity-0", "pointer-events-none");
  }
});

// 点击按钮平滑滚动到顶部
btnScrollToTop.addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});

function fallbackCopyText(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    showCopyTooltip("已复制");
  } catch (err) {
    showCopyTooltip("复制失败", true);
  }
  document.body.removeChild(textarea);
}

// 添加复制按钮
document.addEventListener("DOMContentLoaded", () => {
  const codeBlocks = document.querySelectorAll("pre > code");

  codeBlocks.forEach((codeEl) => {
    const preEl = codeEl.parentElement as HTMLDivElement;
    const wrapper = document.createElement("div");
    wrapper.className = "relative inline-block w-full";

    // 提取语言名
    let lang = "";
    const match = codeEl.className.match(/language-(\w+)/);
    if (match && match[1]) {
      lang = match[1].toUpperCase();
    }

    // 创建工具栏容器（flex 布局，水平排列）
    const toolbar = document.createElement("div");
    toolbar.className = "absolute top-2 right-2 flex items-center gap-2 z-10";

    // 创建语言标签
    const langTag = document.createElement("span");
    langTag.className = "px-2 py-0.5 text-xs font-medium bg-gray-200 rounded";
    langTag.textContent = lang || "CODE";

    // 创建复制按钮
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "p-1.5 text-gray-600 hover:text-gray-900 focus:outline-none transition-colors";
    copyBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
            `;

    // 将语言标签和按钮放入工具栏
    toolbar.appendChild(langTag);
    toolbar.appendChild(copyBtn);

    // 包裹代码块并插入 DOM
    preEl.parentNode?.replaceChild(wrapper, preEl);
    wrapper.appendChild(preEl);
    wrapper.appendChild(toolbar);

    // 绑定复制事件
    copyBtn.addEventListener("click", async () => {
      try {
        // 尝试现代 API
        await navigator.clipboard.writeText(codeEl.textContent || "");
        showCopyTooltip("已复制");
      } catch (err) {
        console.warn("Clipboard API 失败:", err);
        // 降级到传统方法
        fallbackCopyText(codeEl.textContent || "");
      }
    });
  });
});

function showCopyTooltip(text: string, isError = false) {
  let tooltip = document.getElementById("global-copy-tooltip");

  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "global-copy-tooltip";
    tooltip.className =
      "fixed top-12 left-1/2 -translate-x-1/2 px-4 py-2 text-sm text-white bg-green-500 rounded shadow-lg opacity-0 pointer-events-none transition-opacity duration-300 z-50";
    document.body.appendChild(tooltip);
  }

  tooltip.textContent = text;
  tooltip.style.backgroundColor = isError ? "#ef4444" : "#4ACBA0";
  tooltip.classList.remove("opacity-0");
  tooltip.classList.add("opacity-100");

  // 1.5 秒后淡出
  setTimeout(() => {
    tooltip.classList.remove("opacity-100");
    tooltip.classList.add("opacity-0");
  }, 1500);
}

// 高亮标签
document.addEventListener("DOMContentLoaded", function () {
  const currentPath = window.location.pathname;

  // 只匹配分类区域内的 a 标签
  const filterContainer = document.getElementById("filters");
  if (!filterContainer) return;

  const filterLinks = filterContainer.querySelectorAll("a");

  filterLinks.forEach((link) => {
    const href = link.getAttribute("href");

    // 忽略空链接、锚点、外部链接
    if (!href || href === "#" || href.startsWith("http") || href.startsWith("mailto:")) {
      return;
    }

    // 判断是否完全匹配当前路径
    if (href === currentPath) {
      link.classList.add("active-menu");
    }
  });
});

// 高亮分类
document.addEventListener("DOMContentLoaded", function () {
  const currentPath = window.location.pathname;

  // 只匹配标签区域内的 a 标签
  const tagsContainer = document.getElementById("filters");
  if (!tagsContainer) return;

  const tagLinks = tagsContainer.querySelectorAll("a");

  tagLinks.forEach((link) => {
    const href = link.getAttribute("href");

    // 忽略空链接、锚点、外部链接
    if (!href || href === "#" || href.startsWith("http") || href.startsWith("mailto:")) {
      return;
    }

    // 完全匹配路径时高亮
    if (href === currentPath) {
      link.classList.add("active-menu");
    }
  });
});

// header-menu高亮菜单
document.addEventListener("DOMContentLoaded", function () {
  const currentPath = window.location.pathname;

  // 只匹配菜单区域内的 a 标签
  const menuContainer = document.getElementById("main-menu");
  if (!menuContainer) return;

  const menuLinks = menuContainer.querySelectorAll("a");

  menuLinks.forEach((link) => {
    const href = link.getAttribute("href");

    // 忽略空链接、锚点、外部链接
    if (!href || href === "#" || href.startsWith("http") || href.startsWith("mailto:")) {
      return;
    }

    // 判断是否完全匹配当前路径
    if (href === currentPath) {
      link.classList.add("active-menu");
    }

    // 【可选】如果你希望父级菜单在子页面也高亮，可以加上下面这行：
    // if (currentPath.startsWith(href)) {
    //     link.classList.add("active-menu");
    // }
  });
});

// header-mobile高亮菜单
document.addEventListener("DOMContentLoaded", () => {
  const currentPath = window.location.pathname;
  const allLinks = document.querySelectorAll(".menu-link, .submenu-item a");

  allLinks.forEach((link) => {
    const href = link.getAttribute("href");

    if (!href || href === " ") return; // 忽略空链接

    const linkPath = new URL(href, window.location.origin).pathname;

    if (linkPath === currentPath) {
      link.classList.add("active-menu");

      // 自动展开父菜单
      const parentMenuItem = link.closest(".menu-item") as any;
      if (parentMenuItem && parentMenuItem.__x) {
        parentMenuItem.__x.$data.submenuOpen = true;
      }
    }
  });
});

// 生成目录
document.addEventListener("DOMContentLoaded", function () {
  const imagesContainer = document.getElementById("sidebar-images");

  // 如果存在图片容器，同样延迟显示
  if (imagesContainer) {
    setTimeout(() => {
      imagesContainer.classList.remove("opacity-0");
      imagesContainer.style.fontSize = "";
    }, 200);
  }

  const content = document.getElementById("content");
  const titles = content?.querySelectorAll("h1, h2, h3, h4");
  const tocContainer = document.querySelector(".toc-container") as any;

  // 🔴 没有标题（理论上不会出现，因为服务端已过滤）
  if (!titles || titles.length === 0) {
    tocContainer?.remove();
    return;
  }

  // ✅ 有标题：显示目录（使用动画）
  if (tocContainer) {
    // 等待 reflow，确保布局稳定
    setTimeout(() => {
      tocContainer.style.opacity = "1";
      tocContainer.style.height = "auto";
      tocContainer.style.fontSize = ""; // 恢复字体
    }, 100);

    // 初始化 tocbot
    if (typeof tocbot !== "undefined") {
      (tocbot as any).init({
        tocSelector: "#toc",
        contentSelector: "#content",
        headingSelector: "h1, h2, h3, h4",
        extraListClasses: "space-y-1",
        extraLinkClasses:
          "group rounded px-1.5 py-1 transition-all hover:bg-gray-100 text-sm opacity-80 line-clamp-1 h-[1.68rem]",
        collapseDepth: 6,
        headingsOffset: 200,
        scrollSmooth: false,
        tocScrollOffset: 50,
      });
    }
  }

  // 🔹 锚点跳转偏移（适配你的导航栏高度）
  const navbarHeight = 144; // 你的导航栏高度

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;

      const targetId = href.replace("#", "");
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        const offsetTop = targetElement.getBoundingClientRect().top + window.scrollY - navbarHeight;

        window.scrollTo({
          top: offsetTop,
          behavior: "auto",
        });
      }
    });
  });
});
