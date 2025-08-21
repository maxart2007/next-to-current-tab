const lastActiveTab = {};

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    lastActiveTab[tab.windowId] = { index: tab.index, groupId: tab.groupId };
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  // Capture the last active tab before any asynchronous operations run so we
  // always have the tab that spawned this one, even if the new tab becomes
  // active immediately.
  const last = lastActiveTab[tab.windowId];

  chrome.storage.sync.get({ position: 'after', groupPosition: 'after' }, (prefs) => {

    if (prefs.position === 'start') {
      chrome.tabs.move(tab.id, { index: 0 });
      return;
    }

    if (prefs.position === 'end') {
      chrome.tabs.move(tab.id, { index: -1 });
      return;
    }

    if (last && typeof last.index === 'number') {
      const groupId = last.groupId;

      if (prefs.groupPosition === 'avoid' && groupId >= 0) {
        chrome.tabs.query({ groupId, windowId: tab.windowId }, (groupTabs) => {
          // Fallback to the last known index if the group has no tabs for some
          // reason to avoid moving the tab to the end.
          const maxIndex = groupTabs.length
            ? Math.max(...groupTabs.map((t) => t.index))
            : last.index;
          chrome.tabs.move(tab.id, { index: maxIndex + 1 });
        });
      } else if (prefs.groupPosition === 'first' && groupId >= 0) {
        chrome.tabs.query({ groupId, windowId: tab.windowId }, (groupTabs) => {
          const minIndex = groupTabs.length
            ? Math.min(...groupTabs.map((t) => t.index))
            : last.index;
          chrome.tabs.group({ groupId, tabIds: tab.id }, () => {
            chrome.tabs.move(tab.id, { index: minIndex });
          });
        });
      } else if (prefs.groupPosition === 'last' && groupId >= 0) {
        chrome.tabs.query({ groupId, windowId: tab.windowId }, (groupTabs) => {
          const maxIndex = groupTabs.length
            ? Math.max(...groupTabs.map((t) => t.index))
            : last.index;
          chrome.tabs.group({ groupId, tabIds: tab.id }, () => {
            chrome.tabs.move(tab.id, { index: maxIndex + 1 });
          });
        });
      } else {
        chrome.tabs.move(tab.id, { index: last.index + 1 });
      }
    }
  });
});

