const lastActiveIndex = {};

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    lastActiveIndex[tab.windowId] = tab.index;
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  const index = lastActiveIndex[tab.windowId];
  if (typeof index === 'number') {
    chrome.tabs.move(tab.id, { index: index + 1 });
  }
});
