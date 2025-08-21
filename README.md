# next-to-current-tab

Chromium extension that ensures new tabs open to the right of the current active tab.

An options page allows customizing the position of new tabs (after the active tab,
at the start, or at the end) and whether a tab opened from within a tab group
should instead appear after the entire group.

## Development

1. Load `manifest.json` and `background.js` as an unpacked extension in Chrome or any Chromium-based browser.
2. Open any new tab. It will appear immediately next to the currently active one.

## Bundling

To create a distributable archive:

```bash
zip -r next-to-current-tab.zip manifest.json background.js options.html options.js README.md
```
