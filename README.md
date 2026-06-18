<p align="center">
    
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Status](https://img.shields.io/badge/Status-Active-success)
![Version](https://img.shields.io/badge/Version-v1.0.0-blue)
![Made With](https://img.shields.io/badge/Made%20With-WebSockets-purple)
![Realtime](https://img.shields.io/badge/Realtime-Collaboration-ff69b4)

</p>

# <img src="./frontend/public/Aerix.svg" width="25" /> Aerix

Real-time collaborative whiteboard with Google sign-in, saved boards, voice/video, screen share, chat, and canvas recording.

---

## 📸 Preview
 
---

## ✨ Key Features

- **Google Sign-in** — saved boards and dashboard history
- **Real-time canvas** — drawing, shapes, sticky notes, cursors, laser pointer
- **Voice & video** — opt-in mic/camera on every board
- **Screen share** — resizable side panel with annotation
- **Chat** — emojis, @mentions, reactions
- **Save boards** — persistent boards skip auto-delete
- **Export** — PNG and JSON; optional Google Drive upload for recordings

---

## 🛠️ Tech Stack

| Layer | Stack |
|-------|--------|
| Frontend | React, TypeScript, Vite, Konva, Zustand, Tailwind |
| Backend | Node.js, Express, Socket.io |
| Database | MongoDB |
| Auth | Firebase (Google) |

---

## 📁 Project Structure

```text
Aerix/
├── frontend/                 # React + Vite app
│   ├── src/                  # Pages, components, hooks, stores
│   ├── public/               # Static assets
│   ├── vercel.json           # Vercel SPA config
│   └── .env.example          # VITE_* variables
├── backend/                  # Express + Socket.io API
│   ├── src/                  # Routes, socket handler, models
│   ├── Procfile              # Railway deploy
│   └── .env.example          # MONGO_URI, CLIENT_URL, Firebase Admin
├── render.yaml               # Render backend blueprint
├── package.json              # Root scripts (dev, start, build)
├── Deployment.md             # Production deploy guide
└── README.md
```

---

## 🚀 Getting Started Locally

### 1. Install dependencies

```bash
npm run install:all
```

Or separately:

```bash
cd frontend && npm install
cd ../backend && npm install
```

### 2. Environment variables

**`backend/.env`** (copy from `backend/.env.example`):

```env
PORT=3001
MONGO_URI=mongodb://localhost:27017/aerix
CLIENT_URL=http://localhost:5173
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

**`frontend/.env`** (copy from `frontend/.env.example`) — add your `VITE_FIREBASE_*` keys. Leave `VITE_API_URL` empty for local dev (Vite proxies to `:3001`).

### 3. Run

**Terminal 1 — backend:**
```bash
npm start
```

**Terminal 2 — frontend:**
```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## 🌐 Deployment

See **[Deployment.md](./Deployment.md)** for Vercel (frontend) + Render (backend) + MongoDB Atlas.

| Service | Folder | Platform |
|---------|--------|----------|
| Frontend | `frontend/` | Vercel — set **Root Directory** to `frontend` |
| Backend | `backend/` | Render — uses `render.yaml` |

---

## 🔧 Common Issues

- **CORS error** — `CLIENT_URL` in `backend/.env` must match the frontend URL exactly (no trailing slash).
- **API hits wrong host** — set `VITE_API_URL` on Vercel and redeploy.
- **MongoDB timeout** — allow `0.0.0.0/0` in Atlas Network Access.

---

## ⚖️ License

Educational use only. See [LICENSE.md](./LICENSE.md).
