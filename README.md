# Always Here

A tiny always-on video room for two. One person leaves the page open all day. While they are alone, the camera is off and nothing is streamed. When the other person opens the link, they are in a call within a few seconds. Either side can open first. Leaving puts the other back to "Waiting".

Plain HTML, CSS and JavaScript. No build step, no server of its own. Video and audio go straight between the two devices (WebRTC). The free public PeerJS cloud only helps them find each other.

There is no time limit on calls. The page is hosted on GitHub Pages: `https://migsiii.github.io/always-here/`.

## Start a room

1. Open the site and tap **Start our room**.
2. Copy the invite link and send it **privately** to the other person. Never post it anywhere.
3. Tap **Done** and allow camera, microphone and notifications once. The camera turns off again straight away.

The link holds a random secret key after the `#`. Anyone with the full link can join the room, so treat it like a house key. Nothing about the key is stored in this repository.

Link format (placeholders only):

```
<url>#k=<key>&r=b&na=<name a>&nb=<name b>&ice=<relay>
```

`ice` is optional and holds relay server settings (see "If a call will not connect"). It is saved in that browser and removed from the address bar, like the key. The copied invite link includes it when a relay is set on your device.

`na` and `nb` are optional, URL-encoded display names for the two sides (emoji work). They are saved in that browser, removed from the address bar, and can be edited in Settings. Type them on the share screen and the link is built for you.

## Joining from the link

Open the link in **Safari (iPhone) or Chrome (Android)**, not inside another app's built-in browser (Messenger, Instagram and so on). Tap **Join** once.

**iPhone home-screen app:** Safari and the installed app keep separate storage. Add the page to the home screen first, then open it once from the installed app and paste the link into "I have a link". After that, the home-screen app opens straight into the room.

Phone and desktop, Chrome and Edge, iOS Safari and Android Chrome are all supported. On a phone the flip-camera button appears if there is more than one camera. Picture-in-picture and full screen only show where the browser supports them.

## If a call will not connect (adding a relay)

Most calls connect directly. Some mobile-data networks block that. The page then shows "Couldn't connect on this network. Try Wi-Fi, or add a relay in Settings." after two failed attempts, and dials less often until a call works. To fix it for good, add a **TURN relay**, a server that passes the video along when a direct path is impossible.

1. Get TURN details from a provider (a free tier is enough to start). A relayed call uses roughly 0.5 to 1.5 GB an hour, so check the quota. Calls that connect directly use none.
2. Put them in this shape. Only the placeholders below belong in any file you share. The real username and credential never go in this repository.

   ```
   [{"urls":["turn:<relay host>:3478","turns:<relay host>:443"],"username":"<username>","credential":"<credential>"}]
   ```

3. Either paste that text into **Settings, Relay server (advanced)** on each device and tap **Save relay**, or put it in the link: base64url-encode the same JSON (URL-safe base64, no padding) and add `&ice=<encoded>` after the other link parts. Opening such a link saves it. **Copy invite link** in Settings adds it for you once a relay is set.

Rules: at most 4 entries, and every URL must start with `turn:`, `turns:` or `stun:`. Anything else is ignored. The value is never logged, never sent anywhere except the relay itself, and is kept only in that browser (`localStorage`, key `ah.v1.ice`). Treat a link that holds relay details like the room link: private.

## Keeping the always-on side awake (Windows, Chrome or Edge)

- **Do not let the PC sleep.** Settings, System, Power: set "Screen and sleep" to Never while plugged in. The page keeps the screen awake during a call, but an idle page cannot stop Windows sleeping.
- **Exempt the site from tab sleeping.**
  - Edge: Settings, System and performance, "Efficiency mode" off (or add the site to "Never put these sites to sleep").
  - Chrome: Settings, Performance, "Memory Saver" off, or add the site under "Always keep these sites active".
- **Allow notifications** for the site so you get an alert when the other person arrives while the tab is in the background.
- Keep the tab open and **sound unlocked**: after reloading the page, tap "Enable sound" once if the chip appears.

## Privacy model

- The repository is public, so it contains no secret. The room key is created in your browser and travels only in the link you send.
- The key is hashed into a room ID. Each side proves it knows the key with a challenge and response before any camera or microphone is switched on.
- A wrong or mangled link never connects. It just shows a message.
- While you are alone, no camera or microphone track exists.
- Names ride in the link after the key, and are saved only in that browser. They are never in the code or this repository.

## Develop and test

```
npm install
npx playwright install chromium
npm test          # two-browser tests with fake camera and mic, 2 workers
npm run serve     # static server on http://localhost:8080
```

Tests start a local PeerJS server on port 9000 and use `?signal=localhost:9000` so they never touch the public cloud. Add `?relay=1` on localhost to force relayed (TURN) media. With no relay set, that cannot connect, which is what the network-failure tests rely on.

## Deploy

GitHub Pages, branch `main`, root folder. All paths are relative, so it works under `/always-here/`.
