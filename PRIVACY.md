# Privacy Policy — Memento Mori Motivation Extension (New Tab)

_Last updated: 2026-07-12_

This extension replaces the browser's New Tab page with a personal dashboard
(to-do list, sticky notes, quotes, image pin boards, a life-progress clock, and
a search box). This policy explains what data it handles.

## Summary

- The extension has **no backend server**. We (the developer) do not collect,
  receive, sell, or share any of your data.
- Everything you create — settings, to-dos, sticky notes, pinned images, and
  wallpaper — is stored **locally on your device** using the browser's
  `chrome.storage.local` API.
- Data leaves your device only through **two optional features you turn on
  yourself**, and then only to the third-party service that provides that
  feature, described below.

## Data stored locally on your device

- **Dashboard content and preferences:** enabled features, theme, wallpaper
  choice, to-do items, sticky notes, and life-clock configuration.
- **Pinned images (website content):** image URLs, or images you upload/paste,
  saved to your pin boards. Stored locally as data.
- **Authentication information:** if you enable Trello sync, your Trello API key
  and token are stored locally so the extension can talk to Trello on your
  behalf. They are never sent to us or to anyone other than Trello.

This data stays on your device. Uninstalling the extension or clearing browser
data removes it.

## Third-party services (optional)

- **Trello (https://api.trello.com):** Only if you enable Trello sync and enter
  your own Trello API key and token. The extension reads the cards in the list
  you choose and creates, updates, completes, or deletes cards so your to-do
  list mirrors your own Trello board. This data is exchanged only between your
  browser and Trello, using your own credentials. See Trello's privacy policy
  for how Trello handles it.
- **ZenQuotes (https://zenquotes.io):** Fetches an inspirational quote to
  display. The extension only makes outbound requests to retrieve quotes; it
  sends none of your data. You can disable this and use bundled offline quotes.

Neither service is contacted unless you enable the corresponding feature.

## What we do not do

- We do not sell or transfer your data to third parties.
- We do not use or transfer your data for any purpose unrelated to providing
  this New Tab dashboard.
- We do not use your data to determine creditworthiness or for lending.
- We do not use remote code; all extension code ships in the package.

## Contact

Questions: feifan.liu@utexas.edu
