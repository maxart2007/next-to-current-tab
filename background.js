import {
  clampToUnpinned,
  creationAction,
  indexAtStart,
  indexImmediatelyAfter,
  isGroupEdge,
  isGroupedId,
  isSplitId,
  placementFor,
} from './positioning.js';

// Session storage keeps the focused tab id per window across service-worker
// restarts. Index and group are read live so closes and drags cannot stale them.
const lastActiveIdByWindow = new Map();
const previousActiveIdByWindow = new Map();
const waitingForUrl = new Map();
const tails = new Map();

function noteActivation(windowId, tabId) {
  const current = lastActiveIdByWindow.get(windowId);
  if (current === tabId) return;
  if (current !== undefined) previousActiveIdByWindow.set(windowId, current);
  lastActiveIdByWindow.set(windowId, tabId);
}

function snapshotAnchorId(windowId, newTabId) {
  const current = lastActiveIdByWindow.get(windowId);
  if (current !== undefined && current !== newTabId) return current;
  const previous = previousActiveIdByWindow.get(windowId);
  if (previous !== undefined && previous !== newTabId) return previous;
  return null;
}

function enqueue(windowId, task) {
  const prev = tails.get(windowId) || Promise.resolve();
  const tracked = prev.then(task, task).catch((error) => {
    console.error('Error positioning new tab:', error);
  });
  tails.set(windowId, tracked);
  tracked.then(() => {
    if (tails.get(windowId) === tracked) tails.delete(windowId);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A drag makes the tab strip reject edits. Retry briefly instead of dropping the move.
async function withTabStripRetry(fn) {
  const attempts = 6;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      const message = String(error?.message || error);
      const gone = /no tab with id|invalid tab|no group/i.test(message);
      const retryable = /drag|not editable|cannot be edited/i.test(message);
      if (gone || !retryable || i === attempts - 1) throw error;
      await delay(40 * (i + 1));
    }
  }
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function moveTab(tabId, index) {
  return withTabStripRetry(() => chrome.tabs.move(tabId, { index }));
}

function groupTab(groupId, tabId) {
  return withTabStripRetry(() => chrome.tabs.group({ groupId, tabIds: tabId }));
}

function ungroupTab(tabId) {
  return withTabStripRetry(() => chrome.tabs.ungroup(tabId));
}

async function readStoredActiveId(windowId) {
  const key = String(windowId);
  const data = await chrome.storage.session.get(key);
  const id = data[key]?.id;
  if (typeof id !== 'number') return null;
  if (!lastActiveIdByWindow.has(windowId)) lastActiveIdByWindow.set(windowId, id);
  return id;
}

async function persistActive(windowId, tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (lastActiveIdByWindow.get(windowId) !== tabId) return;
    await chrome.storage.session.set({ [String(windowId)]: { id: tab.id } });
  } catch {
    // The tab closed before it could be recorded.
  }
}

async function seedActiveTabs() {
  const tabs = await chrome.tabs.query({ active: true });
  for (const tab of tabs) {
    noteActivation(tab.windowId, tab.id);
    await chrome.storage.session.set({ [String(tab.windowId)]: { id: tab.id } });
  }
}

async function resolveAnchor(tab, rememberedId) {
  if (tab.openerTabId) {
    try {
      const opener = await chrome.tabs.get(tab.openerTabId);
      if (opener.windowId === tab.windowId && opener.id !== tab.id) return opener;
    } catch {
      // Opener closed before we could read it.
    }
  }

  const storedId = rememberedId ?? (await readStoredActiveId(tab.windowId));
  if (typeof storedId === 'number' && storedId !== tab.id) {
    const anchor = await getTab(storedId);
    if (anchor && anchor.windowId === tab.windowId && anchor.id !== tab.id) return anchor;
  }

  const [active] = await chrome.tabs.query({ windowId: tab.windowId, active: true });
  if (active && active.id !== tab.id) return active;
  return null;
}

// Inserting between the two tabs of a split closes the split on Chrome.
// Place relative to the right-hand tab so the pair stays intact.
async function rightEdgeOfSplit(tab) {
  if (!isSplitId(tab.splitViewId)) return tab;
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const pair = tabs.filter((candidate) => candidate.splitViewId === tab.splitViewId);
  if (pair.length === 0) return tab;
  return pair.reduce((right, candidate) => (candidate.index > right.index ? candidate : right));
}

async function firstUnpinnedIndex(windowId) {
  const pinned = await chrome.tabs.query({ windowId, pinned: true });
  if (pinned.length === 0) return 0;
  return Math.max(...pinned.map((tab) => tab.index)) + 1;
}

async function placeAfter(tab, anchor) {
  const freshTab = await getTab(tab.id);
  const freshAnchor = await getTab(anchor.id);
  if (!freshTab || !freshAnchor) return;
  const target = clampToUnpinned(
    indexImmediatelyAfter(freshAnchor.index, freshTab.index),
    await firstUnpinnedIndex(freshTab.windowId),
    freshTab.pinned
  );
  if (freshTab.index !== target) await moveTab(freshTab.id, target);
}

async function placeStart(tab) {
  const fresh = await getTab(tab.id);
  if (!fresh) return;
  const target = indexAtStart(fresh.pinned, await firstUnpinnedIndex(fresh.windowId));
  if (fresh.index !== target) await moveTab(fresh.id, target);
}

async function placeEnd(tab) {
  await moveTab(tab.id, -1);
}

async function moveToGroupEdge(tabId, groupId, edge) {
  await groupTab(groupId, tabId);
  let fresh = await getTab(tabId);
  if (!fresh) return;
  let members = await chrome.tabs.query({ windowId: fresh.windowId, groupId });
  if (members.length === 0) return;
  let edgeIndex = edge === 'first'
    ? Math.min(...members.map((member) => member.index))
    : Math.max(...members.map((member) => member.index));

  if (fresh.groupId === groupId) {
    if (fresh.index !== edgeIndex) await moveTab(tabId, edgeIndex);
    return;
  }

  // group() did not pull the tab in. Sit against the outside edge, then join.
  const dest = edge === 'first'
    ? (fresh.index < edgeIndex ? edgeIndex - 1 : edgeIndex)
    : (fresh.index > edgeIndex ? edgeIndex + 1 : edgeIndex);
  if (fresh.index !== dest) await moveTab(tabId, dest);
  fresh = await getTab(tabId);
  if (fresh && fresh.groupId !== groupId) await groupTab(groupId, tabId);
  fresh = await getTab(tabId);
  if (!fresh) return;
  members = await chrome.tabs.query({ windowId: fresh.windowId, groupId });
  if (members.length === 0) return;
  edgeIndex = edge === 'first'
    ? Math.min(...members.map((member) => member.index))
    : Math.max(...members.map((member) => member.index));
  if (fresh.index !== edgeIndex) await moveTab(tabId, edgeIndex);
}

async function placeAfterInGroup(tab, anchor) {
  const groupId = anchor.groupId;
  const members = await chrome.tabs.query({ windowId: anchor.windowId, groupId });
  const later = members.filter((member) => member.id !== tab.id && member.index > anchor.index);

  if (later.length === 0) {
    // The anchor is the last member. The index just after it is outside the
    // group, so join explicitly; that appends the tab inside the group.
    await moveToGroupEdge(tab.id, groupId, 'last');
    const freshTab = await getTab(tab.id);
    const freshAnchor = await getTab(anchor.id);
    if (!freshTab || !freshAnchor || freshAnchor.groupId !== groupId) return;
    const target = indexImmediatelyAfter(freshAnchor.index, freshTab.index);
    if (freshTab.index !== target) {
      await moveTab(freshTab.id, target);
      const moved = await getTab(tab.id);
      if (moved && moved.groupId !== groupId) await groupTab(groupId, tab.id);
    }
    return;
  }

  const freshTab = await getTab(tab.id);
  const freshAnchor = await getTab(anchor.id);
  if (!freshTab || !freshAnchor) return;
  const target = indexImmediatelyAfter(freshAnchor.index, freshTab.index);
  if (freshTab.index !== target) await moveTab(tab.id, target);
  const moved = await getTab(tab.id);
  if (!moved || moved.groupId === groupId) return;

  // The boundary slot did not adopt the group. Take the next member's index,
  // which is strictly inside the group.
  const next = later.reduce((earliest, member) => (member.index < earliest.index ? member : earliest));
  const nextNow = await getTab(next.id);
  if (nextNow) await moveTab(tab.id, nextNow.index);
}

async function ungroupIfAtEdge(tab) {
  if (!isGroupedId(tab.groupId)) return;
  const members = await chrome.tabs.query({ windowId: tab.windowId, groupId: tab.groupId });
  if (members.length === 0) return;
  const min = Math.min(...members.map((member) => member.index));
  const max = Math.max(...members.map((member) => member.index));
  // Ungrouping a middle tab would split the group in two.
  if (isGroupEdge(tab.index, min, max)) await ungroupTab(tab.id);
}

async function placeAvoidingGroup(tab, anchor) {
  let fresh = await getTab(tab.id);
  if (!fresh) return;
  const members = await chrome.tabs.query({ windowId: anchor.windowId, groupId });
  const others = members.filter((member) => member.id !== tab.id);

  if (others.length > 0) {
    const last = others.reduce((right, member) => (member.index > right.index ? member : right));
    const dest = indexImmediatelyAfter(last.index, fresh.index);
    if (fresh.index !== dest) await moveTab(tab.id, dest);
    fresh = await getTab(tab.id);
  }

  // Index math cannot leave a group when the tab is already last in the window,
  // and the next index can belong to the following group. Ungroup at an edge.
  if (fresh) await ungroupIfAtEdge(fresh);
}

async function applyGroupPlacement(tab, anchor, groupPosition) {
  if (groupPosition === 'avoid') {
    await placeAvoidingGroup(tab, anchor);
    return;
  }
  if (groupPosition === 'first') {
    await moveToGroupEdge(tab.id, anchor.groupId, 'first');
    return;
  }
  if (groupPosition === 'last') {
    await moveToGroupEdge(tab.id, anchor.groupId, 'last');
    return;
  }
  await placeAfterInGroup(tab, anchor);
}

async function applyWindowPlacement(tab, anchor, position) {
  if (position === 'start') {
    await placeStart(tab);
    return;
  }
  if (position === 'end') {
    await placeEnd(tab);
    return;
  }
  await placeAfter(tab, anchor);
}

async function positionNewTab(tabId, rememberedId) {
  let tab = await getTab(tabId);
  if (!tab) return;

  let win;
  try {
    win = await chrome.windows.get(tab.windowId);
  } catch {
    return;
  }
  if (!win || win.type !== 'normal') return;
  // Moving one half of a split clears the split, and it cannot be restored.
  if (isSplitId(tab.splitViewId)) return;

  const prefs = await chrome.storage.sync.get({ position: 'after', groupPosition: 'after' });
  let anchor = await resolveAnchor(tab, rememberedId);
  if (!anchor) return;
  anchor = await rightEdgeOfSplit(anchor);

  const mode = placementFor({
    anchorGrouped: isGroupedId(anchor.groupId),
    tabPinned: tab.pinned,
    position: prefs.position,
    groupPosition: prefs.groupPosition,
  });

  if (mode === 'avoid' || mode === 'first' || mode === 'last' || (mode === 'after' && isGroupedId(anchor.groupId) && !tab.pinned)) {
    const live = await getTab(anchor.id);
    if (live && isGroupedId(live.groupId)) {
      await applyGroupPlacement(tab, live, mode);
      return;
    }
  }

  await applyWindowPlacement(tab, anchor, mode === 'start' || mode === 'end' ? mode : 'after');
}

function scheduleFromCreated(tab) {
  if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return;
  const rememberedId = snapshotAnchorId(tab.windowId, tab.id);
  const action = creationAction(tab);
  if (action === 'now') {
    enqueue(tab.windowId, () => positionNewTab(tab.id, rememberedId));
    return;
  }
  if (action === 'wait') {
    waitingForUrl.set(tab.id, { windowId: tab.windowId, rememberedId });
  }
}

chrome.runtime.onStartup.addListener(seedActiveTabs);
chrome.runtime.onInstalled.addListener(seedActiveTabs);

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  noteActivation(windowId, tabId);
  persistActive(windowId, tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  lastActiveIdByWindow.delete(windowId);
  previousActiveIdByWindow.delete(windowId);
  chrome.storage.session.remove(String(windowId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  waitingForUrl.delete(tabId);
});

chrome.tabs.onCreated.addListener(scheduleFromCreated);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const pending = waitingForUrl.get(tabId);
  if (!pending) return;
  const url = changeInfo.pendingUrl || changeInfo.url || tab.pendingUrl || tab.url;
  const action = creationAction({ pendingUrl: url });
  if (action === 'wait') return;
  waitingForUrl.delete(tabId);
  if (action === 'now') {
    enqueue(pending.windowId, () => positionNewTab(tabId, pending.rememberedId));
  }
});
