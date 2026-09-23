# Zeta Userscripts

A collection of userscripts that add extra tools and interface features to the Zeta web app.

These scripts are made for personal convenience and are not official Zeta features.

## Scripts

### Zeta KakaoTalk Theme
`zeta-kakaotalk-theme.user.js`

Applies a KakaoTalk-inspired theme to Zeta, including chat, profiles, bookmarks, snapshots, diary/ending/choice screens, report/edit UI, Zetagram, and related interface elements.

### Zeta Capture User Mask
`zeta-capture-user-mask.user.js`

Masks the user's real name and Korean-style given names in Zeta capture mode and capture previews.

### Zeta Capture OOC Hide
`zeta-capture-ooc-hide.user.js`

Detects OOC sections in the user's and narrator's messages and lets you hide selected OOC content from capture previews.

### Zeta Room Manager (Android/PC)
`zeta-room-manager.user.js`

Room management tools for Android and desktop browsers. Supports aliases, searching by plot name, character name, or creator name, and manual full collection of room information.

### Zeta Room Manager (iOS)
`zeta-room-manager-ios.user.js`

iOS/Stay version of Zeta Room Manager with aliases, plot/character/creator search, and manual full collection.

### Zeta Fullscreen
`zeta-fullscreen.user.js`

Adds a fullscreen button to the Zeta chat interface.

### Zeta Full Chat Export
`zeta-full-chat-export.user.js`

Exports the entire conversation or the section between bookmarks as Markdown or TXT.

### Zeta Chat Search
`zeta-chat-search.user.js`

Searches previous messages inside a chat room. Already-read messages are indexed locally so they do not need to be scanned again every time.

## Installation

The easiest way to install the scripts is through the project page:

https://e4493089-cmyk.github.io/zeta-userscripts-site/index.html

You can also install a `.user.js` file directly with a compatible userscript manager.

- Desktop / supported Android browsers: Tampermonkey or another compatible userscript manager
- iOS: Stay or another compatible userscript manager

## Updates

Each userscript contains its own GitHub `@updateURL` and `@downloadURL`.

Compatible userscript managers can check this repository for new versions when the script's `@version` is increased.

Script filenames are kept stable so existing installations can continue using the same update URLs.

## Notes

- These scripts are intended for the Zeta web app at `https://zeta-ai.io/`.
- Zeta interface or behavior changes may temporarily break some features.
- Some scripts store settings, aliases, indexes, or cached information in the browser. Clearing browser/site data may remove that locally stored information.
- This project is unofficial and is not affiliated with or endorsed by Zeta or Scatter Lab.

## Disclaimer

Use at your own risk.

You are responsible for how you use these scripts and for complying with any applicable service rules or terms.

I am not responsible for penalties, account restrictions, suspensions, loss of locally stored data, script malfunctions, or any other consequences resulting from the use of these scripts.
