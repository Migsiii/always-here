# Always Here

A tiny always-on video room for two. One person leaves the page open all day. While they are alone, the camera is off and nothing is streamed. When the other person opens the link, they are in a call within a few seconds. Either side can open first. Leaving puts the other back to "Waiting".

Plain HTML, CSS and JavaScript. No build step, no server of its own. Video and audio go straight between the two devices (WebRTC). The free public PeerJS cloud only helps them find each other.

There is no time limit on calls. The page is hosted on GitHub Pages: `https://migsiii.github.io/always-here/`.

## Using it

There is one room, for the two of us, and nothing to set up or send.

1. Open `https://migsiii.github.io/always-here/`.
2. First time on a device only: tap **I'm Bubiii** or **I'm baba 🐼**. That tap also allows camera, microphone, sound and notifications. The choice is remembered on that device. If the other side is already online, the free one is highlighted for you.
3. That's it. Leave the page open. When the other person opens it, you are in a call within a few seconds. Camera and microphone are off while you are alone.

Wrong person picked? **Settings, Switch person** forgets it. Old invite links (`#k=`, `#r=`, `#na=`, `#nb=`) are ignored and removed from the address bar.

Open it in **Safari (iPhone) or Chrome (Android)**, not inside another app's built-in browser (Messenger, Instagram and so on). **iPhone home-screen app:** Safari and the installed app keep separate storage, so pick who you are once in the installed app too.

Phone and desktop, Chrome and Edge, iOS Safari and Android Chrome are all supported. On a phone the flip-camera button appears if there is more than one camera. Picture-in-picture and full screen only show where the browser supports them.

The room key and the two nicknames are constants in the source (`keys.js` `ROOM_KEY`, `app.js` `PEOPLE`). Only nicknames, never full names.

## If a call will not connect (adding a relay)

Most calls connect directly. Some mobile-data networks block that. The page then shows "Couldn't connect on this network. Try Wi-Fi, or add a relay in Settings." after two failed attempts, and dials less often until a call works. To fix it for good, add a **TURN relay**, a server that passes the video along when a direct path is impossible.

1. Get TURN details from a provider (a free tier is enough to start). A relayed call uses roughly 0.5 to 1.5 GB an hour, so check the quota. Calls that connect directly use none.
2. Put them in this shape. Only the placeholders below belong in any file you share. The real username and credential never go in this repository.

   ```
   [{"urls":["turn:<relay host>:3478","turns:<relay host>:443"],"username":"<username>","credential":"<credential>"}]
   ```

3. Either paste that text into **Settings, Relay server (advanced)** on each device and tap **Save relay**, or open the page once with the same JSON base64url-encoded (URL-safe base64, no padding) after a `#`, as `#ice=<encoded>`. It is saved and removed from the address bar. A shared relay list can also go in the `ICE_SERVERS` constant in `app.js`, but not while the repo is public if it holds a login.

Rules: at most 4 entries, and every URL must start with `turn:`, `turns:` or `stun:`. Anything else is ignored. The value is never logged, never sent anywhere except the relay itself, and is kept only in that browser (`localStorage`, key `ah.v1.ice`). Keep any link that holds relay details private.

## Keeping the always-on side awake (Windows, Chrome or Edge)

- **Do not let the PC sleep.** Settings, System, Power: set "Screen and sleep" to Never while plugged in. The page keeps the screen awake during a call, but an idle page cannot stop Windows sleeping.
- **Exempt the site from tab sleeping.**
  - Edge: Settings, System and performance, "Efficiency mode" off (or add the site to "Never put these sites to sleep").
  - Chrome: Settings, Performance, "Memory Saver" off, or add the site under "Always keep these sites active".
- **Allow notifications** for the site so you get an alert when the other person arrives while the tab is in the background.
- Keep the tab open and **sound unlocked**: after reloading the page, tap "Enable sound" once if the chip appears.

## Privacy model

- The repository is public, so the room key is public too. That is accepted: this is a personal room for two, and it is not advertised. Anyone who read the source could try to join it, and the page only ever connects one other person at a time.
- Each side still proves it knows the key with a challenge and response before any camera or microphone is switched on.
- While you are alone, no camera or microphone track exists.
- No login, passcode, relay credential or full name is in this repository. A relay login, if you use one, stays in that browser only.

## Develop and test

```
npm install
npx playwright install chromium
npm test          # two-browser tests with fake camera and mic, 2 workers
npm run serve     # static server on http://localhost:8080
```

Tests start a local PeerJS server on port 9000 and use `?signal=localhost:9000` so they never touch the public cloud. Add `?room=<key>` (localhost only) to give each test its own room, and `?relay=1` on localhost to force relayed (TURN) media. With no relay set, that cannot connect, which is what the network-failure tests rely on.

## Deploy

GitHub Pages, branch `main`, root folder. All paths are relative, so it works under `/always-here/`.
