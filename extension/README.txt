Record and Play - Smart (Option A: backend http://localhost:3000/save)
====================================================================

Files:
- manifest.json
- background.js (service worker)
- content-loader.js (lightweight, always runs)
- content.js (heavy recorder, injected when recording starts)
- popup.html / popup.js
- README.txt

How it works:
1. content-loader.js runs on every page but does a tiny job only.
2. When you press 'Start Recording' popup asks background to inject content.js into the active tab (only if it's a normal http(s) page).
3. content.js records clicks/inputs/navigation and sends events to background.
4. On Stop, popup asks background for state. Upload sends collected actions to backend at http://localhost:3000/save.

Install:
1. Copy the ZIP to your machine and unzip somewhere (~/Downloads/record-and-play-smart-A)
2. Open chrome://extensions, enable Developer mode, Load unpacked -> select the folder

Test:
1. Start your backend: node server.js (should be listening on http://localhost:3000)
2. Open a normal website (https://example.com)
3. Click extension icon -> Start Recording
4. Interact: click several elements, type in inputs
5. Click extension -> Stop Recording
6. Preview will show the actions; Click Upload -> file will be saved by backend into recordings/

Notes:
- The extension will refuse to inject content.js on chrome:// or extension pages and will show a helpful message.
- If a tab is navigated away during recording the content.js will still post navigation events.
