const TOGGLE_MESSAGE = { type: "clean-reader:toggle" };

function isMissingReceiver(error) {
  return /receiving end does not exist|could not establish connection/i.test(
    (error && error.message) || ""
  );
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
