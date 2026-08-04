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
    currentArticle: null,
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

  function normalizeFragmentAnchors(candidate) {
    candidate.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      const anchor = heading.querySelector("a[id], a[name]");
      const targetId = anchor && getAnchorTargetId(anchor);
      if (targetId && !heading.id) {
        heading.id = targetId;
      }
    });

    candidate.querySelectorAll("a[name]").forEach((anchor) => {
      const targetId = getAnchorTargetId(anchor);
      if (targetId && !anchor.id) {
        anchor.id = targetId;
      }
    });
  }

  function getAnchorTargetId(anchor) {
    return (anchor.getAttribute("id") || anchor.getAttribute("name") || "").trim();
  }

  function decodeHashTarget(value) {
    const raw = String(value || "").replace(/^#/, "");
    if (!raw) {
      return "";
    }

    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function findHashTarget(root, hash) {
    const id = decodeHashTarget(hash);
    if (!id || !root) {
      return null;
    }

    if (typeof root.getElementById === "function") {
      const target = root.getElementById(id);
      if (target) {
        return target;
      }
    }

    return Array.from(root.querySelectorAll("[id]")).find((element) => element.id === id) || null;
  }

  function cleanAttributes(candidate) {
    candidate.querySelectorAll("*").forEach((element) => {
      const tag = element.tagName.toLowerCase();

      if (tag === "a") {
        const href = absolutizeUrl(element.getAttribute("href"));
        const anchorTargetId = getAnchorTargetId(element);
        const heading = element.closest("h1, h2, h3, h4, h5, h6");

        if (!href && heading && heading.id && heading.id === anchorTargetId) {
          unwrap(element);
          return;
        }

        if (!href && anchorTargetId && !element.id) {
          element.id = anchorTargetId;
        }

        if (!href && !getAnchorTargetId(element)) {
          unwrap(element);
          return;
        }
      }

      Array.from(element.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        const allowed =
          (name === "id" && value.trim()) ||
          (tag === "a" && name === "href") ||
          (tag === "img" && ["src", "srcset", "alt", "title", "width", "height"].includes(name)) ||
          (["td", "th"].includes(tag) && ["colspan", "rowspan"].includes(name)) ||
          (tag === "code" && name === "class" && /^language-/.test(value));

        if (!allowed) {
          element.removeAttribute(attr.name);
        }
      });

      if (tag === "a") {
        const href = absolutizeUrl(element.getAttribute("href"));
        if (href) {
          element.setAttribute("href", href);
        } else {
          element.removeAttribute("href");
        }
        if (href && !href.startsWith("#")) {
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
      const isAnchorTarget = element.id && (tag === "a" || /^h[1-6]$/.test(tag));
      if (!text && !hasMedia && !isAnchorTarget) {
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
    normalizeFragmentAnchors(candidate);
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

  function slugify(value, fallback = "article") {
    const slug = normalizeText(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return slug || fallback;
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uniqueId(base, used) {
    let id = slugify(base, "section");
    let index = 2;

    while (used.has(id)) {
      id = `${slugify(base, "section")}-${index}`;
      index += 1;
    }

    used.add(id);
    return id;
  }

  function prepareEpubContent(contentRoot) {
    const clone = contentRoot.cloneNode(true);
    const used = new Set();
    const idMap = new Map();

    clone.querySelectorAll("[id]").forEach((element) => {
      const oldId = element.id;
      const newId = uniqueId(oldId || element.textContent, used);
      if (oldId) {
        if (!idMap.has(oldId)) {
          idMap.set(oldId, newId);
        }
      }
      element.id = newId;
    });

    clone.querySelectorAll("h2, h3").forEach((heading) => {
      if (!heading.id) {
        heading.id = uniqueId(heading.textContent, used);
      }
    });

    clone.querySelectorAll('a[href^="#"]').forEach((link) => {
      const decoded = decodeHashTarget(link.getAttribute("href"));

      if (idMap.has(decoded)) {
        link.setAttribute("href", `#${idMap.get(decoded)}`);
      }
    });

    return clone;
  }

  function serializeXhtmlNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeXml(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    const allowedTags = new Set([
      "a",
      "abbr",
      "b",
      "blockquote",
      "br",
      "caption",
      "cite",
      "code",
      "dd",
      "del",
      "div",
      "dl",
      "dt",
      "em",
      "figcaption",
      "figure",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "img",
      "li",
      "ol",
      "p",
      "pre",
      "s",
      "section",
      "small",
      "span",
      "strong",
      "sub",
      "sup",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "u",
      "ul"
    ]);

    if (tag === "picture") {
      return Array.from(node.childNodes).map(serializeXhtmlNode).join("");
    }

    if (!allowedTags.has(tag)) {
      return Array.from(node.childNodes).map(serializeXhtmlNode).join("");
    }

    const attributes = [];
    const id = node.getAttribute("id");

    if (id) {
      attributes.push(`id="${escapeXml(id)}"`);
    }

    if (tag === "a") {
      const href = node.getAttribute("href");
      if (href) {
        attributes.push(`href="${escapeXml(href)}"`);
      }
    } else if (tag === "img") {
      const src = node.getAttribute("src");
      if (!src) {
        return "";
      }

      attributes.push(`src="${escapeXml(src)}"`);
      attributes.push(`alt="${escapeXml(node.getAttribute("alt") || "")}"`);

      ["title", "width", "height"].forEach((name) => {
        const value = node.getAttribute(name);
        if (value && /^[\w .,:;!?'"()/-]+$/.test(value)) {
          attributes.push(`${name}="${escapeXml(value)}"`);
        }
      });
    } else if (tag === "td" || tag === "th") {
      ["colspan", "rowspan"].forEach((name) => {
        const value = node.getAttribute(name);
        if (value && /^\d+$/.test(value)) {
          attributes.push(`${name}="${value}"`);
        }
      });
    }

    if (tag === "br" || tag === "hr" || tag === "img") {
      return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""} />`;
    }

    const children = Array.from(node.childNodes).map(serializeXhtmlNode).join("");
    return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${children}</${tag}>`;
  }

  function serializeXhtmlChildren(node) {
    return Array.from(node.childNodes).map(serializeXhtmlNode).join("");
  }

  function buildToc(contentRoot) {
    const items = Array.from(contentRoot.querySelectorAll("h2, h3")).slice(0, 80);

    if (!items.length) {
      return '<li><a href="content.xhtml">Start</a></li>';
    }

    return items
      .map((heading) => {
        const id = heading.id ? `#${heading.id}` : "";
        return `<li><a href="content.xhtml${escapeXml(id)}">${escapeXml(
          normalizeText(heading.textContent)
        )}</a></li>`;
      })
      .join("\n");
  }

  function textToUtf8(value) {
    return new TextEncoder().encode(value);
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[i] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value, true);
  }

  function concatBytes(chunks, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  function createZip(files) {
    const chunks = [];
    const centralDirectory = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = textToUtf8(file.name);
      const dataBytes = file.data instanceof Uint8Array ? file.data : textToUtf8(file.data);
      const crc = crc32(dataBytes);
      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);

      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, 0x0800);
      writeUint16(localView, 8, 0);
      writeUint16(localView, 10, 0);
      writeUint16(localView, 12, 0);
      writeUint32(localView, 14, crc);
      writeUint32(localView, 18, dataBytes.length);
      writeUint32(localView, 22, dataBytes.length);
      writeUint16(localView, 26, nameBytes.length);
      writeUint16(localView, 28, 0);

      chunks.push(localHeader, nameBytes, dataBytes);
      centralDirectory.push({ file, nameBytes, dataBytes, crc, offset });
      offset += localHeader.length + nameBytes.length + dataBytes.length;
    });

    const centralOffset = offset;

    centralDirectory.forEach((entry) => {
      const header = new Uint8Array(46);
      const view = new DataView(header.buffer);

      writeUint32(view, 0, 0x02014b50);
      writeUint16(view, 4, 20);
      writeUint16(view, 6, 20);
      writeUint16(view, 8, 0x0800);
      writeUint16(view, 10, 0);
      writeUint16(view, 12, 0);
      writeUint16(view, 14, 0);
      writeUint32(view, 16, entry.crc);
      writeUint32(view, 20, entry.dataBytes.length);
      writeUint32(view, 24, entry.dataBytes.length);
      writeUint16(view, 28, entry.nameBytes.length);
      writeUint16(view, 30, 0);
      writeUint16(view, 32, 0);
      writeUint16(view, 34, 0);
      writeUint16(view, 36, 0);
      writeUint32(view, 38, 0);
      writeUint32(view, 42, entry.offset);

      chunks.push(header, entry.nameBytes);
      offset += header.length + entry.nameBytes.length;
    });

    const centralSize = offset - centralOffset;
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);

    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, files.length);
    writeUint16(endView, 10, files.length);
    writeUint32(endView, 12, centralSize);
    writeUint32(endView, 16, centralOffset);
    writeUint16(endView, 20, 0);

    chunks.push(endRecord);
    offset += endRecord.length;

    return concatBytes(chunks, offset);
  }

  function createEpub(article, contentRoot) {
    const preparedContent = prepareEpubContent(contentRoot);
    const title = article.title || document.title || "Article";
    const creator = article.byline || article.site || "";
    const language = (document.documentElement.lang || "en").split("-")[0] || "en";
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const identifier =
      crypto && crypto.randomUUID
        ? `urn:uuid:${crypto.randomUUID()}`
        : `urn:clean-reader:${Date.now()}`;
    const metaParts = [article.site, article.byline, article.published, location.href].filter(Boolean);
    const body = serializeXhtmlChildren(preparedContent);
    const toc = buildToc(preparedContent);
    const creatorNode = creator ? `<dc:creator>${escapeXml(creator)}</dc:creator>` : "";
    const dateNode = article.published ? `<dc:date>${escapeXml(article.published)}</dc:date>` : "";

    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;

    const packageOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    ${creatorNode}
    ${dateNode}
    <dc:source>${escapeXml(location.href)}</dc:source>
    <meta property="dcterms:modified">${escapeXml(modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml" />
    <item id="style" href="style.css" media-type="text/css" />
  </manifest>
  <spine>
    <itemref idref="content" />
  </spine>
</package>`;

    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css" />
  </head>
  <body>
    <nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>${escapeXml(title)}</h1>
      <ol>
        ${toc}
      </ol>
    </nav>
  </body>
</html>`;

    const contentXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
  <head>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css" />
  </head>
  <body>
    <article>
      <header>
        <p class="meta">${escapeXml(metaParts.join(" / "))}</p>
        <h1>${escapeXml(title)}</h1>
      </header>
      ${body}
    </article>
  </body>
</html>`;

    const bookCss = `body {
  color: #1f2933;
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.55;
  margin: 6%;
}

h1, h2, h3, h4, h5, h6 {
  font-family: sans-serif;
  line-height: 1.2;
}

a {
  color: #0b65c2;
}

a:not([href]) {
  color: inherit;
  text-decoration: none;
}

blockquote {
  border-left: 0.25em solid #9aa6b2;
  margin-left: 0;
  padding-left: 1em;
}

img {
  display: block;
  height: auto;
  margin: 1em auto;
  max-width: 100%;
}

pre, code {
  font-family: monospace;
}

table {
  border-collapse: collapse;
  width: 100%;
}

td, th {
  border: 1px solid #cbd5e1;
  padding: 0.35em 0.5em;
}

.meta {
  color: #64748b;
  font-family: sans-serif;
  font-size: 0.85em;
}`;

    const zipBytes = createZip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml", data: containerXml },
      { name: "OEBPS/package.opf", data: packageOpf },
      { name: "OEBPS/nav.xhtml", data: navXhtml },
      { name: "OEBPS/content.xhtml", data: contentXhtml },
      { name: "OEBPS/style.css", data: bookCss }
    ]);

    return {
      blob: new Blob([zipBytes], { type: "application/epub+zip" }),
      filename: `${slugify(title)}.epub`
    };
  }

  function buildCurrentEpub() {
    const contentRoot = state.shadow && state.shadow.querySelector(".reader-content");

    if (!state.currentArticle || !contentRoot) {
      const article = extractArticle();
      const wrapper = document.createElement("div");
      wrapper.appendChild(article.content.cloneNode(true));
      return createEpub(article, wrapper);
    }

    return createEpub(state.currentArticle, contentRoot);
  }

  function downloadEpub(button) {
    const { blob, filename } = buildCurrentEpub();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);

    if (button) {
      const previous = button.textContent;
      button.textContent = "OK";
      window.setTimeout(() => {
        button.textContent = previous;
      }, 900);
    }

    return { filename, size: blob.size, type: blob.type };
  }

  function scrollReaderToHash(hash, behavior = "smooth") {
    if (!state.shadow) {
      return false;
    }

    const scrollRoot = state.shadow.querySelector(".reader-scroll");
    const target = findHashTarget(state.shadow, hash);
    if (!scrollRoot || !target) {
      return false;
    }

    const targetRect = target.getBoundingClientRect();
    const scrollRect = scrollRoot.getBoundingClientRect();
    scrollRoot.scrollTo({
      top: scrollRoot.scrollTop + targetRect.top - scrollRect.top - 16,
      behavior
    });
    return true;
  }

  function handleArticleClick(event) {
    const target =
      event.target instanceof Element ? event.target : event.target && event.target.parentElement;
    const link = target && target.closest('a[href^="#"]');
    if (!link) {
      return;
    }

    const hash = link.getAttribute("href");
    if (!scrollReaderToHash(hash)) {
      return;
    }

    event.preventDefault();
    try {
      history.pushState(null, "", hash);
    } catch {
      location.hash = hash;
    }
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
    state.currentArticle = {
      title: article.title,
      byline: article.byline,
      published: article.published,
      site: article.site,
      wordCount: article.wordCount,
      readTime: article.readTime
    };

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
          <button type="button" data-action="download-epub" title="Download EPUB" aria-label="Download EPUB">EPUB</button>
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
    state.shadow.querySelector(".reader-article").addEventListener("click", handleArticleClick);

    applySettings();
    state.shadow.querySelector(".reader-scroll").focus({ preventScroll: true });
    if (location.hash) {
      window.requestAnimationFrame(() => {
        scrollReaderToHash(location.hash, "auto");
      });
    }
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
    } else if (action === "download-epub") {
      downloadEpub(event.currentTarget);
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
    state.currentArticle = null;
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

      .reader-toolbar [data-action="download-epub"] {
        font-size: 10px;
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

      .reader-content a:not([href]) {
        color: inherit;
        text-decoration: none;
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
    close: closeReader,
    downloadEpub,
    createEpub: buildCurrentEpub
  };
})();
