(() => {
  const API_KEY = "__cleanArticleReader";
  const MESSAGE_TYPE = "clean-reader:toggle";
  const SETTINGS_KEY = "cleanArticleReaderSettings";
  const PAGE_CLASSES = {
    html: ["clearly-overflow", "clean-reader-overflow"],
    body: ["clearly-enabled", "clean-reader-enabled"]
  };
  const DEFAULT_SETTINGS = {
    theme: "dark",
    fontSize: 20,
    lineHeight: 1.65,
    width: 760,
    serif: false
  };

  if (window[API_KEY]) {
    return;
  }

  const state = {
    active: false,
    root: null,
    shadow: null,
    settings: { ...DEFAULT_SETTINGS }
  };

  const BLOCK_TAGS = [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "canvas",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "label",
    "nav",
    "header",
    "footer",
    "aside",
    "dialog"
  ];

  const KEEP_EMPTY_TAGS = new Set([
    "br",
    "hr",
    "img",
    "picture",
    "source",
    "td",
    "th",
    "iframe",
    "video",
    "audio"
  ]);

  const POSITIVE_RE =
    /article|body|content|entry|hentry|main|page|post|rich-text|story|text/i;
  const NEGATIVE_RE =
    /ad-|ads|advert|banner|breadcrumb|browser-warning|comment|community|consent|cookie|dialog|feedback|form|ie11-notification|latest-news|masthead|menu|modal|nav|newsletter|outbrain|overlay|pager|pagination|popup|promo|recaptcha|recommend|related|share|shopping|sidebar|sign-post|social|sponsor|subscribe|toolbar|unsupported-browser|utility|widget/i;
  const JUNK_HEADING_RE =
    /^(related|recommended|more from|more on|read next|you might also|latest|popular|share|was this page helpful|feedback|subscribe|newsletter)\b/i;

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function getMeta(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element && element.getAttribute("content");
      if (value) {
        return normalizeText(value);
      }
    }
    return "";
  }

  function cleanTitle(value) {
    const title = normalizeText(value);
    if (!title) {
      return "";
    }

    const parts = title
      .split(/\s(?:[|-]|\u2013|\u2014|\u00b7)\s/)
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.length > 1 ? parts[0] : title;
  }

  function getArticleTitle(container) {
    const h1 = container && container.querySelector("h1");
    return (
      cleanTitle(getMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]'])) ||
      cleanTitle(h1 && h1.textContent) ||
      cleanTitle(document.title) ||
      "Untitled"
    );
  }

  function getByline(container) {
    const bylineSelectors = [
      '[rel="author"]',
      '[itemprop="author"]',
      '[class*="author" i]',
      '[id*="author" i]',
      '[class*="byline" i]',
      '[id*="byline" i]'
    ];
    const metaAuthor = getMeta([
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="parsely-author"]'
    ]);

    if (metaAuthor) {
      return metaAuthor;
    }

    for (const selector of bylineSelectors) {
      const element = container && container.querySelector(selector);
      const value = normalizeText(element && element.textContent);
      if (value && value.length < 120) {
        return value.replace(/^by\s+/i, "");
      }
    }

    return "";
  }

  function getPublishedDate(container) {
    const metaDate = getMeta([
      'meta[property="article:published_time"]',
      'meta[name="date"]',
      'meta[name="publish-date"]',
      'meta[name="pubdate"]',
      'meta[itemprop="datePublished"]'
    ]);
    const time = container && container.querySelector("time[datetime], time");
    const raw = metaDate || (time && (time.getAttribute("datetime") || time.textContent));
    const value = normalizeText(raw);

    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value.length < 60 ? value : "";
    }

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function getSiteName() {
    return (
      cleanTitle(getMeta(['meta[property="og:site_name"]'])) ||
      location.hostname.replace(/^www\./, "")
    );
  }

  function getSignal(element) {
    return normalizeText(
      [
        element.tagName,
        element.id,
        typeof element.className === "string" ? element.className : "",
        element.getAttribute("role") || "",
        element.getAttribute("aria-label") || ""
      ].join(" ")
    );
  }

  function isProbablyHidden(element) {
    if (
      element.hidden ||
      element.getAttribute("aria-hidden") === "true" ||
      element.getAttribute("inert") !== null
    ) {
      return true;
    }

    const style = element.getAttribute("style") || "";
    return /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)/i.test(style);
  }

  function pruneUnwanted(root) {
    root.querySelectorAll(BLOCK_TAGS.join(",")).forEach((element) => element.remove());
    root
      .querySelectorAll(
        '[role="navigation"], [role="banner"], [role="contentinfo"], [aria-modal="true"], #clearly-root, #clear-reader-root, #clearly-skim-root, #clearly-skim-hint-root'
      )
      .forEach((element) => element.remove());

    Array.from(root.querySelectorAll("*")).forEach((element) => {
      if (!root.contains(element) || isProbablyHidden(element)) {
        element.remove();
        return;
      }

      const signal = getSignal(element);
      const textLength = normalizeText(element.textContent).length;
      const imageCount = element.querySelectorAll("img, picture").length;

      if (NEGATIVE_RE.test(signal) && !POSITIVE_RE.test(signal) && textLength < 1800 && imageCount < 2) {
        element.remove();
      }
    });

    root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      if (JUNK_HEADING_RE.test(normalizeText(heading.textContent))) {
        const removable = findRemovableSection(heading, root);
        removable.remove();
      }
    });
  }

  function findRemovableSection(heading, root) {
    let current = heading;
    while (
      current.parentElement &&
      current.parentElement !== root &&
      normalizeText(current.parentElement.textContent).length < 1200
    ) {
      current = current.parentElement;
    }
    return current;
  }

  function scoreCandidate(element) {
    const text = normalizeText(element.textContent);
    if (text.length < 240) {
      return 0;
    }

    const paragraphs = Array.from(
      element.querySelectorAll("p, li, blockquote, pre")
    ).filter((node) => normalizeText(node.textContent).length > 25);
    const paragraphLength = paragraphs.reduce(
      (total, node) => total + normalizeText(node.textContent).length,
      0
    );
    const linkTextLength = Array.from(element.querySelectorAll("a")).reduce(
      (total, link) => total + normalizeText(link.textContent).length,
      0
    );
    const linkDensity = linkTextLength / Math.max(text.length, 1);
    const signal = getSignal(element);
    const tag = element.tagName.toLowerCase();
    const commas = (text.match(/[,.;:]/g) || []).length;

    let score = Math.sqrt(text.length);
    score += Math.min(paragraphLength / 16, 480);
    score += paragraphs.length * 22;
    score += Math.min(commas * 2, 160);
    score += element.querySelector("h1, h2") ? 35 : 0;
    score += element.querySelector("img, picture, figure") ? 18 : 0;

    if (tag === "article" || tag === "main") {
      score += 85;
    }
    if (POSITIVE_RE.test(signal)) {
      score += 70;
    }
    if (NEGATIVE_RE.test(signal)) {
      score -= 140;
    }
    if (linkDensity > 0.35) {
      score *= 0.45;
    }
    if (linkDensity > 0.6) {
      score *= 0.2;
    }

    return score;
  }

  function pickMainCandidate(root) {
    const candidateSet = new Set([root]);
    root
      .querySelectorAll(
        'article, main, [role="main"], section, div, .article, .post, .entry, .content, .rich-text-editor'
      )
      .forEach((element) => {
        const text = normalizeText(element.textContent);
        const paragraphCount = element.querySelectorAll("p, li, blockquote").length;
        if (text.length > 240 && paragraphCount > 1) {
          candidateSet.add(element);
        }
      });

    let best = root;
    let bestScore = scoreCandidate(root);

    candidateSet.forEach((element) => {
      const score = scoreCandidate(element);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    });

    const structural = Array.from(root.querySelectorAll('article, main, [role="main"]'))
      .filter((element) => normalizeText(element.textContent).length > 900)
      .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];

    if (structural) {
      const structuralScore = scoreCandidate(structural);
      const structuralLength = normalizeText(structural.textContent).length;
      const bestLength = normalizeText(best.textContent).length;

      if (structuralScore >= bestScore * 0.48 || structuralLength >= bestLength * 1.4) {
        best = structural;
        bestScore = structuralScore;
      }
    }

    while (best.parentElement && best.parentElement !== root) {
      const parent = best.parentElement;
      const parentScore = scoreCandidate(parent);
      const bestLength = normalizeText(best.textContent).length;
      const parentLength = normalizeText(parent.textContent).length;

      if (parentScore >= bestScore * 0.78 && parentLength <= bestLength * 2.8) {
        best = parent;
        bestScore = parentScore;
        continue;
      }

      break;
    }

    return best;
  }

  function absolutizeUrl(value) {
    if (!value) {
      return "";
    }

    const trimmed = value.trim();
    if (!trimmed || /^(javascript|data:text\/html)/i.test(trimmed)) {
      return "";
    }

    try {
      const url = new URL(trimmed, location.href);
      const pageUrl = new URL(location.href);
      if (
        url.hash &&
        url.origin === pageUrl.origin &&
        url.pathname === pageUrl.pathname &&
        url.search === pageUrl.search
      ) {
        return url.hash;
      }
      return url.href;
    } catch {
      return "";
    }
  }

  function absolutizeSrcset(value) {
    return (value || "")
      .split(",")
      .map((part) => {
        const pieces = part.trim().split(/\s+/);
        const url = absolutizeUrl(pieces.shift() || "");
        return url ? [url, ...pieces].join(" ") : "";
      })
      .filter(Boolean)
      .join(", ");
  }

  function unwrap(element) {
    const parent = element.parentNode;
    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    element.remove();
  }

  function removeDuplicateTitle(candidate, title) {
    const heading = candidate.querySelector("h1, h2");
    if (!heading) {
      return;
    }

    const headingText = cleanTitle(heading.textContent);
    if (headingText && title && headingText.toLowerCase() === title.toLowerCase()) {
      heading.remove();
    }
  }

  function normalizeHeadingAnchors(candidate) {
    candidate.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      const anchor = heading.querySelector("a[id]");
      if (anchor && !heading.id) {
        heading.id = anchor.id;
      }
    });
  }

  function cleanAttributes(candidate) {
    candidate.querySelectorAll("*").forEach((element) => {
      const tag = element.tagName.toLowerCase();

      if (tag === "a") {
        const href = absolutizeUrl(element.getAttribute("href"));
        if (!href) {
          unwrap(element);
          return;
        }
      }

      Array.from(element.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        const allowed =
          (tag === "a" && name === "href") ||
          (tag === "img" && ["src", "srcset", "alt", "title", "width", "height"].includes(name)) ||
          (["td", "th"].includes(tag) && ["colspan", "rowspan"].includes(name)) ||
          (/^h[1-6]$/.test(tag) && name === "id") ||
          (tag === "code" && name === "class" && /^language-/.test(value));

        if (!allowed) {
          element.removeAttribute(attr.name);
        }
      });

      if (tag === "a") {
        const href = absolutizeUrl(element.getAttribute("href"));
        element.setAttribute("href", href);
        if (!href.startsWith("#")) {
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
        }
      }

      if (tag === "img") {
        const src =
          absolutizeUrl(
            element.getAttribute("src") ||
              element.getAttribute("data-src") ||
              element.getAttribute("data-original") ||
              element.getAttribute("data-lazy-src")
          ) || "";
        const srcset = absolutizeSrcset(
          element.getAttribute("srcset") || element.getAttribute("data-srcset")
        );

        if (!src && !srcset) {
          element.remove();
          return;
        }

        if (src) {
          element.setAttribute("src", src);
        }
        if (srcset) {
          element.setAttribute("srcset", srcset);
        }
        element.setAttribute("loading", "lazy");
        element.setAttribute("decoding", "async");
      }
    });
  }

  function removeEmptyBlocks(candidate) {
    const nodes = Array.from(candidate.querySelectorAll("*")).reverse();
    nodes.forEach((element) => {
      const tag = element.tagName.toLowerCase();
      if (KEEP_EMPTY_TAGS.has(tag)) {
        return;
      }

      const text = normalizeText(element.textContent);
      const hasMedia = element.querySelector("img, picture, table, pre, code, blockquote");
      if (!text && !hasMedia) {
        element.remove();
      }
    });
  }

  function simplifyWrappers(candidate) {
    candidate.querySelectorAll("div, section").forEach((element) => {
      const text = normalizeText(element.textContent);
      const media = element.querySelector("img, picture, table, pre, blockquote");
      const blockChildren = Array.from(element.children).filter((child) =>
        /^(p|h[1-6]|ul|ol|blockquote|pre|figure|table|img)$/i.test(child.tagName)
      );

      if (text.length < 80 && !media) {
        unwrap(element);
        return;
      }

      if (blockChildren.length === element.children.length && !media) {
        unwrap(element);
      }
    });
  }

  function sanitizeCandidate(candidate, title) {
    candidate = candidate.cloneNode(true);
    pruneUnwanted(candidate);
    normalizeHeadingAnchors(candidate);
    removeDuplicateTitle(candidate, title);
    cleanAttributes(candidate);
    removeEmptyBlocks(candidate);
    simplifyWrappers(candidate);
    removeEmptyBlocks(candidate);

    const fragment = document.createDocumentFragment();
    while (candidate.firstChild) {
      fragment.appendChild(candidate.firstChild);
    }
    return fragment;
  }

  function extractArticle() {
    const bodyClone = document.body.cloneNode(true);
    pruneUnwanted(bodyClone);
    const candidate = pickMainCandidate(bodyClone);
    const title = getArticleTitle(candidate);
    const byline = getByline(candidate);
    const published = getPublishedDate(candidate);
    const site = getSiteName();
    const content = sanitizeCandidate(candidate, title);
    const text = normalizeText(content.textContent);
    const wordCount = text ? text.split(/\s+/).length : 0;

    return {
      title,
      byline,
      published,
      site,
      wordCount,
      readTime: Math.max(1, Math.round(wordCount / 225)),
      content
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadSettings() {
    return new Promise((resolve) => {
      const fallback = () => {
        try {
          const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
          resolve({ ...DEFAULT_SETTINGS, ...stored });
        } catch {
          resolve({ ...DEFAULT_SETTINGS });
        }
      };

      if (!chrome.storage || !chrome.storage.local) {
        fallback();
        return;
      }

      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        if (chrome.runtime.lastError) {
          fallback();
          return;
        }
        resolve({ ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) });
      });
    });
  }

  function saveSettings() {
    const value = { ...state.settings };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    } catch {
      // Ignore storage failures in locked-down pages.
    }

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [SETTINGS_KEY]: value });
    }
  }

  function cycleTheme() {
    const themes = ["dark", "light", "sepia"];
    const index = themes.indexOf(state.settings.theme);
    state.settings.theme = themes[(index + 1) % themes.length];
    applySettings();
    saveSettings();
  }

  function cycleWidth() {
    const widths = [680, 760, 860, 980];
    const index = widths.indexOf(state.settings.width);
    state.settings.width = widths[(index + 1) % widths.length];
    applySettings();
    saveSettings();
  }

  function changeFontSize(delta) {
    state.settings.fontSize = Math.min(28, Math.max(16, state.settings.fontSize + delta));
    applySettings();
    saveSettings();
  }

  function toggleTypeface() {
    state.settings.serif = !state.settings.serif;
    applySettings();
    saveSettings();
  }

  function applySettings() {
    if (!state.shadow) {
      return;
    }

    const shell = state.shadow.querySelector(".reader-shell");
    const article = state.shadow.querySelector(".reader-article");
    if (!shell || !article) {
      return;
    }

    shell.dataset.theme = state.settings.theme;
    article.classList.toggle("reader-article--serif", state.settings.serif);
    article.style.setProperty("--reader-font-size", `${state.settings.fontSize}px`);
    article.style.setProperty("--reader-line-height", String(state.settings.lineHeight));
    article.style.setProperty("--reader-width", `${state.settings.width}px`);
  }

  function ensureShellRoots() {
    if (!document.getElementById("clearly-skim-root")) {
      const skimRoot = document.createElement("div");
      skimRoot.id = "clearly-skim-root";
      document.body.appendChild(skimRoot);
    }

    if (!document.getElementById("clearly-skim-hint-root")) {
      const hintRoot = document.createElement("div");
      hintRoot.id = "clearly-skim-hint-root";
      document.body.appendChild(hintRoot);
    }
  }

  function buildRoot() {
    ensureShellRoots();

    let root = document.getElementById("clearly-root");
    if (root && root.dataset.cleanReader !== "true") {
      root = document.getElementById("clear-reader-root");
    }

    if (!root) {
      root = document.createElement("div");
      root.id = "clearly-root";
      document.body.appendChild(root);
    }

    root.dataset.cleanReader = "true";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Reader view");
    root.hidden = false;

    state.root = root;
    state.shadow = root.shadowRoot || root.attachShadow({ mode: "open" });
    return root;
  }

  function render(article) {
    buildRoot();

    const meta = [article.site, article.byline, article.published, `${article.readTime} min read`]
      .filter(Boolean)
      .map(escapeHtml)
      .join("<span></span>");

    state.shadow.innerHTML = `
      <style>${getShadowStyles()}</style>
      <div id="clearly-container" class="reader-shell" data-theme="${escapeHtml(state.settings.theme)}">
        <div class="reader-toolbar" aria-label="Reader controls">
          <button type="button" data-action="close" title="Close reader" aria-label="Close reader">X</button>
          <button type="button" data-action="font-down" title="Smaller text" aria-label="Smaller text">-A</button>
          <button type="button" data-action="font-up" title="Larger text" aria-label="Larger text">A+</button>
          <button type="button" data-action="theme" title="Change theme" aria-label="Change theme">Aa</button>
          <button type="button" data-action="width" title="Change width" aria-label="Change width">&lt;&gt;</button>
          <button type="button" data-action="typeface" title="Toggle serif" aria-label="Toggle serif">S</button>
        </div>
        <main class="reader-scroll" tabindex="-1">
          <article class="reader-article">
            <header class="reader-header">
              <div class="reader-meta">${meta}</div>
              <h1>${escapeHtml(article.title)}</h1>
            </header>
            <div class="reader-content"></div>
          </article>
        </main>
      </div>
    `;

    state.shadow.querySelector(".reader-content").appendChild(article.content);
    state.shadow.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", handleAction);
    });

    applySettings();
    state.shadow.querySelector(".reader-scroll").focus({ preventScroll: true });
  }

  function handleAction(event) {
    const action = event.currentTarget.dataset.action;
    if (action === "close") {
      closeReader();
    } else if (action === "font-down") {
      changeFontSize(-1);
    } else if (action === "font-up") {
      changeFontSize(1);
    } else if (action === "theme") {
      cycleTheme();
    } else if (action === "width") {
      cycleWidth();
    } else if (action === "typeface") {
      toggleTypeface();
    }
  }

  async function openReader() {
    if (state.active) {
      return;
    }

    state.settings = await loadSettings();
    const article = extractArticle();

    PAGE_CLASSES.html.forEach((name) => document.documentElement.classList.add(name));
    PAGE_CLASSES.body.forEach((name) => document.body.classList.add(name));
    render(article);
    document.addEventListener("keydown", handleKeydown, true);
    state.active = true;
  }

  function closeReader() {
    if (!state.active && !state.root) {
      return;
    }

    document.removeEventListener("keydown", handleKeydown, true);
    PAGE_CLASSES.html.forEach((name) => document.documentElement.classList.remove(name));
    PAGE_CLASSES.body.forEach((name) => document.body.classList.remove(name));

    if (state.root) {
      state.root.remove();
    }

    const skimRoot = document.getElementById("clearly-skim-root");
    const hintRoot = document.getElementById("clearly-skim-hint-root");
    if (skimRoot && !skimRoot.childElementCount) {
      skimRoot.remove();
    }
    if (hintRoot && !hintRoot.childElementCount) {
      hintRoot.remove();
    }

    state.active = false;
    state.root = null;
    state.shadow = null;
  }

  function toggleReader() {
    if (state.active) {
      closeReader();
      return;
    }
    openReader();
  }

  function handleKeydown(event) {
    if (!state.active) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeReader();
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeFontSize(1);
    } else if (event.key === "-") {
      event.preventDefault();
      changeFontSize(-1);
    } else if (event.key.toLowerCase() === "t") {
      cycleTheme();
    }
  }

  function getShadowStyles() {
    return `
      :host {
        all: initial;
        box-sizing: border-box;
        color-scheme: light dark;
        display: block;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      .reader-shell {
        --bg-color: #090b0f;
        --font-color: #c9d1d9;
        --link-color: #58a6ff;
        --main-color: #161b22;
        --muted-color: #8b949e;
        --border-color: rgba(139, 148, 158, 0.22);
        --button-bg: rgba(240, 246, 252, 0.07);
        --button-bg-hover: rgba(240, 246, 252, 0.13);
        background: var(--bg-color);
        color: var(--font-color);
        display: grid;
        grid-template-columns: 58px 1fr;
        height: 100vh;
        width: 100vw;
      }

      .reader-shell[data-theme="light"] {
        --bg-color: #f4f6f8;
        --font-color: #1f2933;
        --link-color: #0b65c2;
        --main-color: #ffffff;
        --muted-color: #64748b;
        --border-color: rgba(15, 23, 42, 0.12);
        --button-bg: rgba(15, 23, 42, 0.06);
        --button-bg-hover: rgba(15, 23, 42, 0.12);
      }

      .reader-shell[data-theme="sepia"] {
        --bg-color: #f1eadf;
        --font-color: #2e2822;
        --link-color: #8b3f16;
        --main-color: #fbf7ef;
        --muted-color: #77695d;
        --border-color: rgba(77, 62, 48, 0.16);
        --button-bg: rgba(77, 62, 48, 0.08);
        --button-bg-hover: rgba(77, 62, 48, 0.14);
      }

      .reader-toolbar {
        align-items: center;
        background: var(--main-color);
        border-right: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 9px;
      }

      .reader-toolbar button {
        appearance: none;
        background: var(--button-bg);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--font-color);
        cursor: pointer;
        font: 700 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        height: 38px;
        margin: 0;
        padding: 0;
        width: 38px;
      }

      .reader-toolbar button:hover,
      .reader-toolbar button:focus-visible {
        background: var(--button-bg-hover);
        outline: 2px solid transparent;
      }

      .reader-scroll {
        background: var(--bg-color);
        height: 100vh;
        overflow: auto;
        padding: clamp(28px, 5vw, 68px) clamp(18px, 6vw, 88px);
        scroll-behavior: smooth;
      }

      .reader-scroll:focus {
        outline: none;
      }

      .reader-article {
        background: var(--main-color);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        color: var(--font-color);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        font-size: var(--reader-font-size, 20px);
        line-height: var(--reader-line-height, 1.65);
        margin: 0 auto;
        max-width: min(var(--reader-width, 760px), 100%);
        min-height: calc(100vh - clamp(56px, 10vw, 136px));
        padding: clamp(28px, 5vw, 62px);
      }

      .reader-article--serif {
        font-family: Charter, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      }

      .reader-header {
        border-bottom: 1px solid var(--border-color);
        margin-bottom: 1.65em;
        padding-bottom: 1.4em;
      }

      .reader-header h1 {
        color: var(--font-color);
        font-size: clamp(2rem, 4.6vw, 3.6rem);
        font-weight: 760;
        letter-spacing: 0;
        line-height: 1.08;
        margin: 0;
      }

      .reader-meta {
        color: var(--muted-color);
        display: flex;
        flex-wrap: wrap;
        font-size: 0.76em;
        gap: 0.55em;
        line-height: 1.4;
        margin-bottom: 1em;
      }

      .reader-meta span::before {
        content: "/";
        opacity: 0.55;
      }

      .reader-content {
        overflow-wrap: anywhere;
      }

      .reader-content > *:first-child {
        margin-top: 0;
      }

      .reader-content p,
      .reader-content ul,
      .reader-content ol,
      .reader-content blockquote,
      .reader-content pre,
      .reader-content table,
      .reader-content figure {
        margin: 0 0 1.15em;
      }

      .reader-content h1,
      .reader-content h2,
      .reader-content h3,
      .reader-content h4,
      .reader-content h5,
      .reader-content h6 {
        color: var(--font-color);
        font-weight: 760;
        letter-spacing: 0;
        line-height: 1.18;
        margin: 1.8em 0 0.6em;
      }

      .reader-content h1 { font-size: 1.9em; }
      .reader-content h2 { font-size: 1.55em; }
      .reader-content h3 { font-size: 1.25em; }
      .reader-content h4,
      .reader-content h5,
      .reader-content h6 { font-size: 1.05em; }

      .reader-content a {
        color: var(--link-color);
        text-decoration: underline;
        text-decoration-thickness: 0.08em;
        text-underline-offset: 0.18em;
      }

      .reader-content ul,
      .reader-content ol {
        padding-left: 1.35em;
      }

      .reader-content li {
        margin: 0.35em 0;
      }

      .reader-content blockquote {
        border-left: 4px solid var(--link-color);
        color: var(--font-color);
        margin-left: 0;
        padding-left: 1em;
      }

      .reader-content img,
      .reader-content picture,
      .reader-content video {
        display: block;
        height: auto;
        margin: 1.2em auto;
        max-width: 100%;
      }

      .reader-content figure {
        margin-left: 0;
        margin-right: 0;
      }

      .reader-content figcaption {
        color: var(--muted-color);
        font-size: 0.82em;
        line-height: 1.45;
        margin-top: -0.55em;
        text-align: center;
      }

      .reader-content pre,
      .reader-content code {
        background: rgba(128, 128, 128, 0.13);
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      }

      .reader-content code {
        font-size: 0.88em;
        padding: 0.12em 0.25em;
      }

      .reader-content pre {
        overflow-x: auto;
        padding: 1em;
      }

      .reader-content pre code {
        background: transparent;
        padding: 0;
      }

      .reader-content table {
        border-collapse: collapse;
        display: block;
        font-size: 0.9em;
        overflow-x: auto;
        width: 100%;
      }

      .reader-content th,
      .reader-content td {
        border: 1px solid var(--border-color);
        padding: 0.5em 0.65em;
        text-align: left;
        vertical-align: top;
      }

      @media (max-width: 720px) {
        .reader-shell {
          grid-template-columns: 1fr;
          grid-template-rows: 52px 1fr;
        }

        .reader-toolbar {
          border-bottom: 1px solid var(--border-color);
          border-right: 0;
          flex-direction: row;
          justify-content: center;
          padding: 7px 8px;
        }

        .reader-toolbar button {
          height: 36px;
          width: 40px;
        }

        .reader-scroll {
          height: calc(100vh - 52px);
          padding: 14px;
        }

        .reader-article {
          border-radius: 6px;
          min-height: calc(100vh - 80px);
          padding: 24px 18px;
        }
      }
    `;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === MESSAGE_TYPE) {
      toggleReader();
    }
  });

  window[API_KEY] = {
    toggle: toggleReader,
    open: openReader,
    close: closeReader
  };
})();
