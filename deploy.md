# Deploying Astro Party

## Deploying on Vercel
Vercel is fantastic for static sites and serverless functions, but **it is not recommended for real-time WebSocket applications like Astro Party**. 

Vercel uses "Serverless Functions" which spin up and down per request. They do not maintain a continuous connection or a shared in-memory state (like our `rooms` object) which Socket.IO requires. 

Therefore, you **must** deploy your Node.js backend (and frontend) on a platform that supports persistent Node.js servers and WebSockets (like Render, Railway, or Fly.io).

---

## Deploying on Render (Recommended)
Render is an easy and free (with sleeping) persistent server provider that works perfectly for Socket.IO.

### Prerequisites
1. Push your code to a GitHub repository.
2. Ensure you have `node main.js` or `node server.js` set in your `package.json` under the `start` script:
   ```json
   "scripts": {
     "start": "node server.js"
   }
   ```

### Deployment Steps
1. Sign up / Log in to [Render](https://render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub account and select your `spaceparty` repository.
4. Render will auto-detect "Node". 
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Select the **Free** tier.
6. Click **Create Web Service**.
7. Render will build and deploy your app. It will give you a URL like `https://spaceparty-xyz.onrender.com`.

---

## Deploying on Railway (Alternative)
Railway is another excellent option with a generous trial/hobby tier.

### Deployment Steps
1. Make sure your `package.json` has the start script (as mentioned above).
2. Go to [Railway.app](https://railway.app/).
3. Click **New Project** -> **Deploy from GitHub repo**.
4. Select your `spaceparty` repo.
5. Railway will automatically detect the Node.js environment, install express/socket.io, and start your server using the scripts defined in your `package.json`.
6. Go to the project settings and click **Generate Domain** so the world can access it.

---

## Modifying Code for Production (Optional)
Currently, `client.js` uses `const socket = io();` which automatically connects back to the host serving the file. This means there is **zero code change required**! It works locally (`localhost:3001`) and will work seamlessly on your deployed Render/Railway URL.
