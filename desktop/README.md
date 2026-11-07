# Nexus Tracker (desktop app)

Opens Nexus Work in its own window and makes time tracking automatic. While a timer is running:

- Screenshots of the main screen are taken every 5–10 minutes, with no "share your screen" prompt, and they keep going after a reload.
- Key presses and mouse clicks are counted across the whole computer. Only the number is kept, never which keys were pressed.
- Screen recording starts on the main screen without the "choose a screen" dialog.

None of this runs when no timer is on. A tray icon turns green while tracking, and Windows shows a notice when tracking starts.
Closing the window while a timer is running keeps the app in the tray. Quit from the tray icon.

## Run

The API (`server`) and the web app (`client`) must be running first.

```bash
cd desktop
npm install
npm start
```

To use a different web address: `NEXUS_URL=https://nexus.example.com npm start`.

## Check it works

```bash
npm run selftest
```

This prints a `SELFTEST` line. `screenshot.ok` should be `true`, and `inputHook.ok` should be `true` for counting across the whole computer.
If `inputHook.ok` is `false`, the app still works, but it counts keys and clicks inside the Nexus window only.

## Tell people

Anyone tracked with this app should know about it before they use it: what is captured (screenshots, key and click counts, recordings), when it is captured (only while their timer runs), and who can see it (themselves and workspace owners and admins).
