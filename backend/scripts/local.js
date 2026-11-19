import 'dotenv/config'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const dbPath = resolve('.local-data/mongodb')
await mkdir(dbPath, { recursive: true })
// A fixed port keeps the address stable, so tools like MongoDB Compass can stay connected
// across restarts. 27018 avoids clashing with a separately installed MongoDB on 27017.
const port = Number(process.env.LOCAL_MONGO_PORT || 27018)
// Uses a real MongoDB process with a persistent local data directory. Never used in production.
let mongo
try {
  mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger', dbName: 'zephros', port } })
} catch (error) {
  console.error(`[Local] Could not start MongoDB on port ${port}: ${error.message}`)
  console.error('[Local] If another program uses that port, run with a different one, e.g. LOCAL_MONGO_PORT=27019')
  process.exit(1)
}
console.log('[Local] MongoDB ready. Data directory:', dbPath)
console.log(`[Local] Browse the data in MongoDB Compass: mongodb://127.0.0.1:${port}/zephros`)
const backend = spawn(process.execPath, ['src/index.js'], {
  stdio: 'inherit', env: { ...process.env, MONGO_URI: mongo.getUri('zephros') },
})
// `--lan` (npm run dev:lan) lets phones and laptops on the same Wi-Fi open the app.
// Only the frontend is exposed; it forwards /api and /socket.io to the backend on this machine.
const lan = process.argv.includes('--lan')
if (lan) {
  const addresses = Object.values(networkInterfaces()).flat()
    .filter(net => net && net.family === 'IPv4' && !net.internal).map(net => net.address)
  console.log('[Local] LAN mode: open one of these on another device on the same Wi-Fi:')
  for (const address of addresses) console.log(`[Local]   http://${address}:5173`)
  console.log('[Local] If that stops working, your Wi-Fi gave this PC a new address: run `ipconfig` and use the Wi-Fi IPv4 Address.')
  console.log('[Local] Camera, mic and screen share need HTTPS on other devices: use a tunnel (see README).')
}
const frontend = spawn(process.execPath, ['../frontend/node_modules/vite/bin/vite.js', '--host', lan ? '0.0.0.0' : '127.0.0.1'], {
  cwd: resolve('../frontend'), stdio: 'inherit',
})
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  backend.kill()
  frontend.kill()
  await mongo.stop()
}
backend.once('exit', () => void stop())
frontend.once('exit', () => void stop())
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
