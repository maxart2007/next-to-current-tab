// --- STATE MANAGEMENT ---

// Use session storage, which persists across service worker restarts.
async function updateLastActiveTab(tab) {
  if (!tab) return;
  const data = { [tab.windowId]: { id: tab.id, index: tab.index, groupId: tab.groupId } };
  await chrome.storage.session.set(data);
}

// --- EVENT LISTENERS ---

// Populate storage on startup.
chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({ active: true });
  for (const tab of tabs) {
    await updateLastActiveTab(tab);
  }
});

// Update on tab activation.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await updateLastActiveTab(tab);
});

// Update if the active tab's group changes.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active && typeof changeInfo.groupId !== 'undefined') {
    await updateLastActiveTab(tab);
  }
});

// Clean up storage when a window is closed to prevent memory leaks.
chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.session.remove(String(windowId));
});


// --- CORE LOGIC ---

chrome.tabs.onCreated.addListener(async (tab) => {
  // Guard clause remains the same.
  if (!tab.openerTabId && tab.pendingUrl !== 'chrome://newtab/') {
    return;
  }
  
  // Use a try...catch block for robust error handling.
  try {
    const [prefs, lastActiveTabs] = await Promise.all([
      chrome.storage.sync.get({ position: 'after', groupPosition: 'after' }),
      chrome.storage.session.get(null) // Get all session data
    ]);

    if (prefs.position === 'start') return await chrome.tabs.move(tab.id, { index: 0 });
    if (prefs.position === 'end') return await chrome.tabs.move(tab.id, { index: -1 });

    let parent;
    if (tab.openerTabId) {
      // It's safer to wrap this in a try/catch in case the parent tab closes quickly.
      try {
        parent = await chrome.tabs.get(tab.openerTabId);
      } catch (e) {
        parent = null; // Parent tab is gone, fallback to last active.
      }
    }
    
    const lastActive = lastActiveTabs[tab.windowId];
    const parentIndex = parent?.index ?? lastActive?.index;
    const parentGroupId = parent?.groupId ?? lastActive?.groupId;

    if (typeof parentIndex !== 'number') return; // Cannot determine position, do nothing.

    const inGroup = parentGroupId >= 0;

    // Default: place after parent.
    let targetIndex = parentIndex + 1;

    if (inGroup) {
      if (prefs.groupPosition === 'avoid') {
        const groupTabs = await chrome.tabs.query({ windowId: tab.windowId, groupId: parentGroupId });
        targetIndex = Math.max(...groupTabs.map(t => t.index)) + 1;
      } else if (prefs.groupPosition === 'first') {
        await chrome.tabs.group({ groupId: parentGroupId, tabIds: tab.id });
        const groupTabs = await chrome.tabs.query({ windowId: tab.windowId, groupId: parentGroupId });
        targetIndex = Math.min(...groupTabs.map(t => t.index));
      } else if (prefs.groupPosition === 'last') {
        await chrome.tabs.group({ groupId: parentGroupId, tabIds: tab.id });
        const groupTabs = await chrome.tabs.query({ windowId: tab.windowId, groupId: parentGroupId });
        targetIndex = Math.max(...groupTabs.map(t => t.index));
      }
    }
    
    await chrome.tabs.move(tab.id, { index: targetIndex });

  } catch (error) {
    console.error("Error positioning new tab:", error);
  }
});