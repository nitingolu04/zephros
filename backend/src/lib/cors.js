/** Comma-separated origins in CLIENT_URL, e.g. https://app.vercel.app,https://app.com */
export function getAllowedOrigins() {
  const raw = process.env.CLIENT_URL || 'http://localhost:5173'
  return raw.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean)
}

export function corsOriginCheck(origin, callback) {
  const allowed = getAllowedOrigins()
  if (!origin || allowed.includes(origin)) {
    callback(null, true)
    return
  }
  callback(null, false)
}
