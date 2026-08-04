const TOGGLE_MESSAGE = { type: "clean-reader:toggle" };

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url || !/^(https?|file):/.test(tab.url)) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, TOGGLE_MESSAGE, () => {
    if (!chrome.runtime.lastError) {
      return;
    }

    chrome.scripting
      .insertCSS({
        target: { tabId: tab.id },
        files: ["reader.css"]
      })
      .then(() =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["contentScript.js"]
        })
      )
      .then(() => chrome.tabs.sendMessage(tab.id, TOGGLE_MESSAGE))
      .catch(() => {
        // Chrome blocks injection on internal pages and some privileged URLs.
      });
  });
});
