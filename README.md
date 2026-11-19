<p align="center">
    
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Status](https://img.shields.io/badge/Status-Active-success)
![Version](https://img.shields.io/badge/Version-v1.0.0-blue)
![Made With](https://img.shields.io/badge/Made%20With-WebSockets-purple)
![Realtime](https://img.shields.io/badge/Realtime-Collaboration-ff69b4)

</p>

# <img src="./frontend/public/Zephros.svg" width="25" /> Zephros

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
- **Attendance register** — the board owner (teacher) downloads an Excel sheet of everyone who joined: name, email (signed-in users), first joined, last seen, minutes on the board and in the call
- **Share with view or edit access** — the host chooses whether people with the board link can edit or only view, shares a separate editor link with co-teachers, and can switch any participant between editor and viewer live from the People tab; the server rejects every edit from viewers, who can still chat, join the call and use the laser pointer

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
Zephros/
├── frontend/                 # React + Vite app
│   ├── src/                  # Pages, components, hooks, stores
│   ├── public/               # Static assets
│   ├── vercel.json           # Vercel SPA config
│   └── .env.example          # VITE_* variables
├── backend/                  # Express + Socket.io API
│   ├── src/                  # Routes, socket handler, models
│   ├── Procfile              # Railway deploy
│   └── .env.example          # MONGO_URI, CLIENT_URL, Firebase Admin
├── render.yaml               # Render blueprint (frontend static site + backend)
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
MONGO_URI=mongodb://localhost:27017/zephros
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

**No MongoDB installed?** Run everything (a private local MongoDB, backend and frontend) with one command:
```bash
npm run dev:local
```
While it runs, browse the data in MongoDB Compass at `mongodb://127.0.0.1:27018/zephros` (set `LOCAL_MONGO_PORT` to use another port).

**Test with two devices (no deployment):**
```bash
npm run dev:lan
```
Open `http://<this PC's Wi-Fi IPv4>:5173` (find it with `ipconfig`) on **both** devices on the same Wi-Fi, then join the same board. Drawing, cursors and chat work over plain HTTP. For **camera, mic and screen share** on the second device, browsers require HTTPS, so start a free tunnel and open its `https://…trycloudflare.com` address on both devices instead:
```bash
cloudflared tunnel --url http://localhost:5173
```

### 4. Tests

```bash
npm test
```
Runs the backend integration suite (REST + Socket.IO) against an in-memory MongoDB — no setup needed.

---

## 🧩 Backend features

| Feature | How it works |
|---------|--------------|
| **Real-time sync** | Socket.IO events, serialized per board so concurrent edits never overtake each other |
| **Access control** | Board passwords (scrypt, brute-force limited), sign-in-required boards, locked rooms, owner-only settings |
| **Chat history** | Stored in MongoDB (latest 500 per board); joiners receive recent history; reactions are toggled server-side |
| **Attendance** | `GET /api/board/:id/attendance?tz=…` returns an `.xlsx` register (owner only); join, leave and call times are recorded per participant session, with atomic updates so a disconnect never double-counts |
| **Roles** | Each participant session is an `editor` or `viewer` (owner always edits). `PATCH /api/board/:id` with `linkAccess`, `GET /api/board/:id/share` and `POST .../share/reset` for the editor link, socket `SET_ROLE` for a live change; drawing events, renames and snapshots from viewers are rejected on the server |
| **Version history** | `GET/POST /api/board/:id/versions`, restore and delete; the server auto-snapshots active boards every 2 minutes (only when changed) and saves a "Before restoring" copy on every restore |
| **Cleanup** | Temporary boards (and their chat and versions) are removed a couple of minutes after the last person leaves |
| **API docs** | Swagger UI at [`/api/docs`](http://localhost:3001/api/docs), OpenAPI spec at `/api/openapi.json` |

---

## 🌐 Deployment

Everything deploys on **Render** from one Blueprint (`render.yaml`), with MongoDB Atlas as the database. See **[Deployment.md](./Deployment.md)** for step-by-step setup (Vercel for the frontend is also supported).

| Service | Folder | Platform |
|---------|--------|----------|
| Frontend | `frontend/` | Render **Static Site** (`zephros-frontend`) |
| Backend | `backend/` | Render **Web Service** (`zephros-backend`) |

---

## 🔧 Common Issues

- **CORS error** — `CLIENT_URL` in `backend/.env` must match the frontend URL exactly (no trailing slash).
- **API hits wrong host** — set `VITE_API_URL` on the frontend service and redeploy (it is baked in at build time).
- **MongoDB timeout** — allow `0.0.0.0/0` in Atlas Network Access.

---

## ⚖️ License

Educational use only. See [LICENSE.md](./LICENSE.md).
