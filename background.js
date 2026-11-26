const TOGGLE_MESSAGE = { type: "clean-reader:toggle" };

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
