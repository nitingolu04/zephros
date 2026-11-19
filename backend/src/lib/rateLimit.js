/**
 * Fixed-window in-memory rate limiter.
 * Per process: when scaling horizontally, back this with Redis instead.
 */
export function createLimiter({ limit, windowMs }) {
  const hits = new Map()
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, record] of hits) if (record.until < now) hits.delete(key)
  }, Math.min(windowMs, 60000))
  timer.unref()

  return {
    /** Records one hit; returns true when the key is over its limit. */
    hit(key) {
      const now = Date.now()
      let record = hits.get(key)
      if (!record || record.until < now) {
        record = { count: 0, until: now + windowMs }
        hits.set(key, record)
      }
      return ++record.count > limit
    },
    /** True when the key is already blocked, without recording a hit. */
    blocked(key) {
      const record = hits.get(key)
      return Boolean(record && record.until >= Date.now() && record.count >= limit)
    },
    reset(key) {
      hits.delete(key)
    },
    stop() {
      clearInterval(timer)
    },
  }
}

// Board passwords: 10 wrong guesses per board per client per 15 minutes.
export const passwordAttempts = createLimiter({ limit: 10, windowMs: 15 * 60 * 1000 })
