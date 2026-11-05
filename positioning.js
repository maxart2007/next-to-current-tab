// Pure placement decisions. Chrome calls stay in background.js so this can be tested
// without a browser.

const NTP_PROTOCOLS = new Set(['chrome:', 'edge:', 'brave:', 'vivaldi:']);
const NTP_HOSTS = new Set(['newtab', 'new-tab-page', 'new-tab-page-third-party']);

// chrome://newtab/ cannot be matched with a host permission, which is why the
// extension reads pendingUrl / url under the tabs permission.
export function isNewTabPage(url) {
  if (!url || typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'about:' && parsed.pathname === 'newtab') return true;
  if (parsed.protocol === 'chrome-search:' && parsed.hostname === 'local-ntp') return true;
  if (parsed.protocol === 'opera:' && (parsed.hostname === 'startpage' || parsed.hostname === 'newtab')) {
    return true;
  }
  if (!NTP_PROTOCOLS.has(parsed.protocol)) return false;
  return NTP_HOSTS.has(parsed.hostname);
}

// 'now' positions immediately, 'wait' defers until a URL arrives, 'ignore' leaves
// the tab alone (restores, external opens, other extensions).
export function creationAction({ openerTabId, pendingUrl, url }) {
  if (openerTabId) return 'now';
  const candidate = pendingUrl || url;
  if (isNewTabPage(candidate)) return 'now';
  // about:blank is the transient URL some new tabs show before chrome://newtab/ commits.
  if (!candidate || candidate === 'about:blank') return 'wait';
  return 'ignore';
}

export function isGroupedId(groupId) {
  return typeof groupId === 'number' && groupId >= 0;
}

// Split View uses -1 for "not in a split". Older Chrome omits the field.
export function isSplitId(splitViewId) {
  return typeof splitViewId === 'number' && splitViewId >= 0;
}

// Group controls apply whenever the anchor tab is in a group. The window
// controls apply otherwise, including when the new tab is pinned and cannot
// join a group.
export function placementFor({ anchorGrouped, tabPinned, position, groupPosition }) {
  if (anchorGrouped && !tabPinned) {
    if (groupPosition === 'first' || groupPosition === 'last' || groupPosition === 'avoid' || groupPosition === 'after') {
      return groupPosition;
    }
    return 'after';
  }
  if (position === 'start' || position === 'end' || position === 'after') return position;
  return 'after';
}

// tabs.move() index is the final index. A tab that currently sits left of the
// anchor shifts the anchor left by one when it is removed, so the slot just
// after the anchor is the anchor's current index.
export function indexImmediatelyAfter(anchorIndex, movingIndex) {
  return movingIndex < anchorIndex ? anchorIndex : anchorIndex + 1;
}

export function indexAtStart(tabPinned, firstUnpinned) {
  return tabPinned ? 0 : firstUnpinned;
}

// Unpinned tabs cannot enter the pinned block. Chrome would clamp the move;
// doing it here keeps the tab in the nearest legal slot.
export function clampToUnpinned(target, firstUnpinned, tabPinned) {
  if (tabPinned) return Math.max(0, target);
  return Math.max(target, firstUnpinned);
}

export function isGroupEdge(index, min, max) {
  return index === min || index === max;
}
