// Keep track of the last active tab per window. This is used when a new tab is
// created without an explicit opener (for example, Cmd+clicking a bookmark).
const lastActiveTab = {};

// Populate the cache with currently active tabs when the service worker starts
// so that the very first created tab also has a reference point.
chrome.tabs.query({ active: true }, (tabs) => {
  tabs.forEach((tab) => {
    lastActiveTab[tab.windowId] = {
      id: tab.id,
      index: tab.index,
      groupId: tab.groupId,
    };
  });
});

// Update the cache every time the active tab changes.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  chrome.tabs.get(tabId, (tab) => {
    lastActiveTab[windowId] = {
      id: tabId,
      index: tab.index,
      groupId: tab.groupId,
    };
  });
});

// Adjust the cached index if the active tab is moved.
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  const { windowId, toIndex } = moveInfo;
  const cached = lastActiveTab[windowId];
  if (cached && cached.id === tabId) {
    cached.index = toIndex;
  }
});

// Keep group information up to date if the active tab is moved in or out of a group.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && typeof changeInfo.groupId !== 'undefined') {
    const cached = lastActiveTab[tab.windowId];
    if (cached) {
      cached.groupId = tab.groupId;
    }
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  const parentTabId = tab.openerTabId;
  const winId = tab.windowId;

  chrome.storage.sync.get({ position: 'after', groupPosition: 'after' }, (prefs) => {
    // Простые режимы — как было
    if (prefs.position === 'start') return chrome.tabs.move(tab.id, { index: 0 });
    if (prefs.position === 'end')   return chrome.tabs.move(tab.id, { index: -1 });

    const handleAfterParent = (parent) => {
      const parentIndex = parent?.index ?? lastActiveTab[winId]?.index;
      const parentGroupId = parent?.groupId ?? lastActiveTab[winId]?.groupId;

      if (typeof parentIndex !== 'number') {
        // Фоллбек: поставить после текущего активного или в конец
        return chrome.tabs.move(tab.id, { index: Math.max(0, (tab.index ?? 0) + 1) });
      }

      const inGroup = parentGroupId >= 0;

      if (prefs.groupPosition === 'avoid' && inGroup) {
        chrome.tabs.query({ windowId: winId, groupId: parentGroupId }, (groupTabs) => {
          const maxIndex = groupTabs.length
            ? Math.max(...groupTabs.map(t => t.index))
            : parentIndex;
          chrome.tabs.move(tab.id, { index: maxIndex + 1 });
        });
        return;
      }

      if (prefs.groupPosition === 'first' && inGroup) {
        // Сначала включаем в группу, потом пересчитываем позицию ВНУТРИ группы
        chrome.tabs.group({ groupId: parentGroupId, tabIds: tab.id }, () => {
          chrome.tabs.query({ windowId: winId, groupId: parentGroupId }, (groupTabs) => {
            const minIndex = Math.min(...groupTabs.map(t => t.index));
            chrome.tabs.move(tab.id, { index: minIndex });
          });
        });
        return;
      }

      if (prefs.groupPosition === 'last' && inGroup) {
        chrome.tabs.group({ groupId: parentGroupId, tabIds: tab.id }, () => {
          chrome.tabs.query({ windowId: winId, groupId: parentGroupId }, (groupTabs) => {
            const maxIndex = Math.max(...groupTabs.map(t => t.index));
            chrome.tabs.move(tab.id, { index: maxIndex + 1 });
          });
        });
        return;
      }

      // По умолчанию — просто после родителя
      chrome.tabs.move(tab.id, { index: parentIndex + 1 });
    };

    if (parentTabId) {
      chrome.tabs.get(parentTabId, (parent) => {
        if (chrome.runtime.lastError) return handleAfterParent(null);
        handleAfterParent(parent);
      });
    } else {
      // Фоллбек, если opener нет (новая пустая вкладка, горячая клавиша и т.п.)
      handleAfterParent(null);
    }
  });
});
