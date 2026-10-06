# Running & Deploying Space Party

## Run locally
```bash
npm install
npm start            # http://localhost:3001  (set PORT to change)
```
Friends on the same Wi-Fi can open `http://<your-PC-IP>:3001` on their phones and play in the browser.
Installing as an app needs HTTPS, so that works once deployed (below) — or on `localhost`.

## How it's built
- `public/js/sim.js` — the whole game simulation. The server runs it for online rooms; the browser runs the
  same file for Local Party (and to predict your own ship online), so both modes behave identically.
- `server.js` — Express + Socket.IO. 60 Hz authoritative rooms, snapshots at 30 Hz, 30 s reconnect grace.
- `public/sw.js` + `manifest.webmanifest` — installable PWA. Local Party works fully offline once installed.
- Regenerate icons with `npm run icons`.

## Deploy (needs a host with persistent WebSockets)
Vercel/Netlify serverless functions can't hold Socket.IO rooms in memory — use Render, Railway or Fly.io.

### Render (free tier)
1. Push to GitHub.
2. Render → **New + → Web Service** → pick the repo.
3. Build: `npm install` · Start: `npm start` · Instance: Free.
4. You get `https://spaceparty-xxxx.onrender.com` — HTTPS, so phones can **Install App**
   (Android: install button / browser menu; iPhone: Share → Add to Home Screen).

Free Render instances sleep when idle; the first visit after a while takes ~30 s to wake.

### Railway
New Project → Deploy from GitHub repo → it detects Node and runs `npm start`. Then **Settings → Generate Domain**.

## Shipping updates to installed apps
Bump `CACHE` in `public/sw.js` (e.g. `spaceparty-v3`) when you deploy. Installed apps fetch fresh files
network-first anyway, so players get updates on next launch; the bump just clears old cached files.
