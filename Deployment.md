# Zephros — Deployment Guide

Two ways to deploy, both free:

| | Frontend | Backend | Database |
|--|--|--|--|
| **A. Everything on Render** (recommended) | Render **Static Site** | Render **Web Service** | MongoDB Atlas |
| B. Vercel + Render | Vercel | Render Web Service | MongoDB Atlas |

> **Why the backend can't be a static/serverless deploy:** it is one long-running Socket.IO process that keeps per-board write queues and call rooms in memory and runs background jobs, so it needs a persistent server.

---

## Option A — Everything on Render (one Blueprint)

`render.yaml` defines both services: **zephros-backend** (Web Service) and **zephros-frontend** (Static Site, served from Render's CDN, so it never sleeps).

1. **Push the code to GitHub.** Render builds from the repository.
2. **MongoDB Atlas:** create the database and copy its connection string ([Step 1](#step-1--mongodb-atlas) below).
3. **Render → New → Blueprint →** connect the repo. Render reads `render.yaml` and shows both services.
4. Render asks for each secret value. Fill in what you have now:

   | Service | Variable | Value |
   |--|--|--|
   | zephros-backend | `MONGO_URI` | Atlas connection string |
   | zephros-backend | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | From the Firebase service-account JSON (same as `backend/.env`) |
   | zephros-backend | `CLIENT_URL` | `https://zephros-frontend.onrender.com` *(confirm the real URL after step 5)* |
   | zephros-frontend | `VITE_API_URL` | `https://zephros-backend.onrender.com` *(confirm after step 5)* |
   | zephros-frontend | 6 × `VITE_FIREBASE_*` | Same as `frontend/.env` |

   Render names each site after its service, so the URLs are usually exactly as above. If a name was taken, Render adds a suffix; use the real URLs.
5. Click **Apply**. Both services build. Open each service and **copy its URL** from the top of the page.
6. **If either URL differs from what you entered:** fix `CLIENT_URL` (backend) or `VITE_API_URL` (frontend) under that service's **Environment** tab. Changing `VITE_API_URL` needs a **new frontend deploy** (Manual Deploy → Deploy latest commit), because it is baked in at build time.
7. **Firebase → Authentication → Settings → Authorized domains →** add `zephros-frontend.onrender.com`.
8. Check `https://zephros-backend.onrender.com/api/health` shows `"status":"ok"`, then open the frontend URL and sign in.

> **Free plan:** the backend sleeps after ~15 minutes idle and can take up to a minute to wake. The frontend loads instantly and starts waking the backend automatically; open the site a minute before a demo.

---

## Option B — Vercel (frontend) + Render (backend)

Follow the steps below. In the Render Blueprint, the frontend Static Site is created too; delete **zephros-frontend** in Render if you use Vercel instead.

**Cost:** Free tier on all three services is enough to launch.

---

## Prerequisites

- GitHub account + repo with your Zephros code pushed
- Firebase project (you already use `aerix-acebb` locally)
- ~30 minutes for first-time setup

---

## Step 1 — MongoDB Atlas

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and create a **free M0 cluster**.
2. **Database Access** → Add user with password (save the password).
3. **Network Access** → Add IP Address → **Allow Access from Anywhere** (`0.0.0.0/0`). Required for Render’s dynamic IPs.
4. **Database** → Connect → **Drivers** → copy the connection string:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/zephros?retryWrites=true&w=majority
   ```
   Replace `USER`, `PASSWORD`, and use database name `zephros`.

---

## Step 2 — Backend on Render

### Option A — Blueprint (recommended)

1. [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**.
2. Connect your GitHub repo. Render reads `render.yaml` at the repo root.
3. After deploy, open the **zephros-backend** service → **Environment** and set:

| Variable | Value |
|----------|--------|
| `MONGO_URI` | Your Atlas connection string |
| `CLIENT_URL` | Leave blank for now — set after Vercel deploy |
| `FIREBASE_PROJECT_ID` | e.g. `aerix-acebb` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-...@aerix-acebb.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Full private key from Firebase service account JSON (paste as one line; `\n` for newlines) |

4. Copy your backend URL, e.g. `https://zephros-backend.onrender.com` (no trailing slash).

### Option B — Manual Web Service

1. **New** → **Web Service** → connect repo.
2. **Root Directory:** `backend`
3. **Build Command:** `npm ci --omit=dev`
4. **Start Command:** `node src/index.js`
5. **Health Check Path:** `/api/health`
6. Add the same environment variables as above, plus `NODE_VERSION=22` and `NODE_ENV=production`. `PORT` is set automatically by Render.

### Verify backend

Open `https://YOUR-BACKEND.onrender.com/api/health` — you should see:

```json
{"status":"ok","database":"connected"}
```

> **Note:** Free Render services spin down after ~15 min idle. First request after sleep may take 30–60s.

---

## Step 3 — Frontend on Vercel

1. [Vercel](https://vercel.com/) → **Add New** → **Project** → import your GitHub repo.
2. Set **Root Directory** to `frontend`. Framework auto-detects as **Vite**. `frontend/vercel.json` handles SPA routing.
3. **Environment Variables** (Production):

| Variable | Value |
|----------|--------|
| `VITE_API_URL` | `https://YOUR-BACKEND.onrender.com` |
| `VITE_FIREBASE_API_KEY` | From Firebase web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `aerix-acebb.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | e.g. `aerix-acebb` |
| `VITE_FIREBASE_STORAGE_BUCKET` | e.g. `aerix-acebb.appspot.com` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | From Firebase config |
| `VITE_FIREBASE_APP_ID` | From Firebase config |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | *(Optional)* OAuth Web client ID for Drive uploads |

4. **Deploy**. Copy your Vercel URL, e.g. `https://zephros.vercel.app`.

---

## Step 4 — Connect frontend ↔ backend

1. **Render** → zephros-backend → **Environment** → set:
   ```
   CLIENT_URL=https://YOUR-VERCEL-URL.vercel.app
   ```
   For preview deployments too, use comma-separated origins:
   ```
   CLIENT_URL=https://zephros.vercel.app,https://zephros-git-main-you.vercel.app
   ```
2. Save — Render redeploys automatically.

---

## Step 5 — Firebase authorized domains

1. [Firebase Console](https://console.firebase.google.com/) → your project → **Authentication** → **Settings** → **Authorized domains**.
2. Add:
   - `YOUR-VERCEL-URL.vercel.app`
   - Your custom domain if you add one later

---

## Step 6 — Google OAuth (optional, for Drive recording upload)

If you use `VITE_GOOGLE_OAUTH_CLIENT_ID`:

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → your OAuth 2.0 Web client.
2. **Authorized JavaScript origins:**
   - `https://YOUR-VERCEL-URL.vercel.app`
3. Enable **Google Drive API** for the project.

---

## Railway (alternative backend)

Same env vars as Render:

1. [Railway](https://railway.app/) → **New Project** → **Deploy from GitHub**.
2. Set **Root Directory** to `backend` (uses `backend/Procfile`).
3. **Start command:** `node src/index.js`
4. Add env vars: `MONGO_URI`, `CLIENT_URL`, `FIREBASE_*`.
5. Generate a public domain under **Settings → Networking**.
6. Use that URL as `VITE_API_URL` on Vercel.

---

## Deployment checklist

- [ ] Atlas cluster running, `MONGO_URI` set on backend
- [ ] Backend `/api/health` returns `ok`
- [ ] `VITE_API_URL` set on Vercel (redeploy after changing)
- [ ] `CLIENT_URL` on backend matches Vercel URL exactly (no trailing slash)
- [ ] Firebase authorized domains include Vercel hostname
- [ ] Firebase Admin keys set on backend
- [ ] Create board → draw → open same link in incognito → real-time sync works
- [ ] Google sign-in works on production URL

---

## Common issues

| Problem | Fix |
|---------|-----|
| **CORS error** | `CLIENT_URL` must match the browser origin exactly. No trailing `/`. |
| **API calls go to wrong host** | Set `VITE_API_URL` on Vercel and **redeploy** (Vite bakes env at build time). |
| **Socket won’t connect** | Confirm `VITE_API_URL` points to Render backend, not Vercel. |
| **MongoDB timeout** | Atlas → Network Access → allow `0.0.0.0/0`. Check username/password in URI. |
| **401 on dashboard** | Set all three `FIREBASE_*` vars on Render backend. |
| **404 on /dashboard refresh** | `vercel.json` rewrites should be in repo; redeploy Vercel. |
| **Slow first load** | Render free tier cold start — normal. Upgrade or use a ping cron. |
| **Vercel build: `VITE_API_URL is not set`** | Add it under Vercel → Settings → Environment Variables, then redeploy. |
| **Mic/video fails remotely** | The app uses a free public TURN relay, which can be unreliable. Use your own TURN service for important demos. |

---

## Custom domain (optional)

**Vercel:** Project → Settings → Domains → add `app.yourdomain.com`.

**Render:** Service → Settings → Custom Domains.

Update `CLIENT_URL`, Firebase authorized domains, and Google OAuth origins to match.

---

## Local vs production

| | Local | Production |
|--|-------|------------|
| Frontend | `npm run dev` from repo root (`frontend/`, :5173) | Vercel (`frontend/`) |
| Backend | `npm start` from repo root (`backend/`, :3001) | Render / Railway (`backend/`) |
| Database | `mongodb://localhost:27017/zephros` | MongoDB Atlas |
| `VITE_API_URL` | empty (Vite proxy) | `https://backend.onrender.com` |

---

## Test deployment

1. Visit your Vercel URL.
2. Sign in with Google.
3. Create a board → **My Boards** on dashboard.
4. Share `/board/...` link with a friend.
5. Draw on both screens — cursors and strokes should sync in real time.

Phase 4 (TURN server for reliable voice/video across networks) is the next step when you’re ready.
