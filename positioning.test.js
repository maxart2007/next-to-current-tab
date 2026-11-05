import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampToUnpinned,
  creationAction,
  indexAtStart,
  indexImmediatelyAfter,
  isGroupEdge,
  isNewTabPage,
  placementFor,
} from './positioning.js';

function move(order, id, finalIndex) {
  const tabs = order.map((entry) => ({ ...entry }));
  const from = tabs.findIndex((entry) => entry.id === id);
  const [tab] = tabs.splice(from, 1);
  tabs.splice(finalIndex, 0, tab);
  return tabs;
}

test('new tab urls include browser variants and ignore ordinary pages', () => {
  assert.equal(isNewTabPage('chrome://newtab/'), true);
  assert.equal(isNewTabPage('chrome://newtab/?espv=1'), true);
  assert.equal(isNewTabPage('chrome://new-tab-page/'), true);
  assert.equal(isNewTabPage('edge://newtab/'), true);
  assert.equal(isNewTabPage('brave://newtab/'), true);
  assert.equal(isNewTabPage('vivaldi://newtab/'), true);
  assert.equal(isNewTabPage('opera://startpage/'), true);
  assert.equal(isNewTabPage('about:newtab'), true);
  assert.equal(isNewTabPage('chrome-search://local-ntp/local-ntp.html'), true);
  assert.equal(isNewTabPage('https://example.com/'), false);
  assert.equal(isNewTabPage('chrome-extension://abc/newtab.html'), false);
  assert.equal(isNewTabPage(''), false);
  assert.equal(isNewTabPage(undefined), false);
});

test('creation action waits only when a no-opener tab has no url yet', () => {
  assert.equal(creationAction({ openerTabId: 4, pendingUrl: 'https://example.com/' }), 'now');
  assert.equal(creationAction({ pendingUrl: 'chrome://newtab/' }), 'now');
  assert.equal(creationAction({ url: 'chrome://new-tab-page/' }), 'now');
  assert.equal(creationAction({}), 'wait');
  assert.equal(creationAction({ url: 'about:blank' }), 'wait');
  assert.equal(creationAction({ openerTabId: 2, url: 'about:blank' }), 'now');
  assert.equal(creationAction({ url: 'https://example.com/' }), 'ignore');
});

test('group placement wins over window placement, except for pinned tabs', () => {
  assert.equal(placementFor({
    anchorGrouped: true,
    tabPinned: false,
    position: 'start',
    groupPosition: 'last',
  }), 'last');
  assert.equal(placementFor({
    anchorGrouped: true,
    tabPinned: false,
    position: 'end',
    groupPosition: 'avoid',
  }), 'avoid');
  assert.equal(placementFor({
    anchorGrouped: false,
    tabPinned: false,
    position: 'end',
    groupPosition: 'first',
  }), 'end');
  assert.equal(placementFor({
    anchorGrouped: true,
    tabPinned: true,
    position: 'start',
    groupPosition: 'last',
  }), 'start');
});

test('index just after the anchor accounts for a tab approaching from the left', () => {
  const strip = [
    { id: 't' },
    { id: 'a' },
    { id: 'p' },
    { id: 'b' },
  ];
  const anchor = 2;
  const moving = 0;
  const target = indexImmediatelyAfter(anchor, moving);
  const next = move(strip, 't', target);
  assert.deepEqual(next.map((entry) => entry.id), ['a', 'p', 't', 'b']);
});

test('index just after the anchor keeps a tab that is already to the right', () => {
  const strip = [
    { id: 'a' },
    { id: 'p' },
    { id: 'b' },
    { id: 't' },
  ];
  const target = indexImmediatelyAfter(1, 3);
  const next = move(strip, 't', target);
  assert.deepEqual(next.map((entry) => entry.id), ['a', 'p', 't', 'b']);
});

test('a tab already just after the anchor is left where it is', () => {
  assert.equal(indexImmediatelyAfter(1, 2), 2);
});

test('open first stays to the right of pinned tabs', () => {
  assert.equal(indexAtStart(false, 3), 3);
  assert.equal(indexAtStart(true, 3), 0);
  assert.equal(clampToUnpinned(0, 2, false), 2);
  assert.equal(clampToUnpinned(4, 2, false), 4);
  assert.equal(clampToUnpinned(-1, 2, true), 0);
});

test('only an edge tab is safe to ungroup', () => {
  assert.equal(isGroupEdge(0, 0, 3), true);
  assert.equal(isGroupEdge(3, 0, 3), true);
  assert.equal(isGroupEdge(1, 0, 3), false);
});
