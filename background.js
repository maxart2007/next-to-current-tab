const lastActiveTab = {};

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    lastActiveTab[tab.windowId] = { index: tab.index, groupId: tab.groupId };
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  chrome.storage.sync.get({ position: 'after', avoidGroups: false }, (prefs) => {
    const last = lastActiveTab[tab.windowId];

    if (prefs.position === 'start') {
      chrome.tabs.move(tab.id, { index: 0 });
      return;
    }

    if (prefs.position === 'end') {
      chrome.tabs.move(tab.id, { index: -1 });
      return;
    }

    if (last && typeof last.index === 'number') {
      if (prefs.avoidGroups && last.groupId >= 0) {
        chrome.tabs.query({ groupId: last.groupId, windowId: tab.windowId }, (groupTabs) => {
          const maxIndex = Math.max(...groupTabs.map((t) => t.index));
          chrome.tabs.move(tab.id, { index: maxIndex + 1 });
        });
      } else {
        chrome.tabs.move(tab.id, { index: last.index + 1 });
      }
    }
  });
});

