const TOGGLE_MESSAGE = { type: "clean-reader:toggle" };
const EPUB_IMAGE_MESSAGE = "clean-reader:fetch-epub-image";
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

async function fetchEpubImage(source) {
  const url = new URL(source);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return null;
  }

  const response = await fetch(url, {
    credentials: "omit",
    signal: AbortSignal.timeout(12000)
  });
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !type.startsWith("image/") ||
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    return null;
  }

  // Chrome extension messages use JSON, so send the image bytes as base64.
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return { type, base64: btoa(binary) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== EPUB_IMAGE_MESSAGE || sender.id !== chrome.runtime.id || !sender.tab) {
    return;
  }

  fetchEpubImage(message.url).then(sendResponse, () => sendResponse(null));
  return true;
});

function isMissingReceiver(error) {
  return /receiving end does not exist|could not establish connection/i.test(
    (error && error.message) || ""
  );
}

async function readStylesheet(filename) {
  const response = await fetch(chrome.runtime.getURL(filename));
  if (!response.ok) {
    throw new Error(`Could not load ${filename} (${response.status})`);
  }
  return response.text();
}

async function injectReader(tabId) {
  const target = { tabId };
  const [readerCss, epubCss] = await Promise.all([
    readStylesheet("reader-view.css"),
    readStylesheet("epub.css")
  ]);

  await chrome.scripting.insertCSS({ target, files: ["reader.css"] });
  await chrome.scripting.executeScript({
    target,
    args: [readerCss, epubCss],
    func: (readerCss, epubCss) => {
      if (!window.__cleanArticleReader) {
        window.__cleanArticleReaderStyles = { readerCss, epubCss };
      }
    }
  });
  await chrome.scripting.executeScript({ target, files: ["contentScript.js"] });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url || !/^(https?|file):/.test(tab.url)) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, TOGGLE_MESSAGE, () => {
    const error = chrome.runtime.lastError;
    if (!error || !isMissingReceiver(error)) {
      return;
    }

    injectReader(tab.id)
      .then(() => chrome.tabs.sendMessage(tab.id, TOGGLE_MESSAGE))
      .catch(() => {
        // Chrome blocks injection on internal pages and some privileged URLs.
      });
  });
});
