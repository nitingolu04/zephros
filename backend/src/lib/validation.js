export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}

export function identifier(value, name = 'id') {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw badRequest(`Invalid ${name}`)
  return value
}

export function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Expected an object')
  return value
}

const numeric = new Set(['x', 'y', 'width', 'height', 'rotation', 'strokeWidth', 'fontSize', 'opacity', 'cornerRadius'])
const strings = new Set(['fill', 'stroke', 'text', 'fontFamily', 'fontStyle', 'textDecoration', 'imageSrc'])
const types = new Set(['rectangle', 'circle', 'line', 'arrow', 'text', 'sticky', 'pen', 'image', 'frame'])

// Only canvas fields may be written. Mongo operators, identity and ownership are never accepted.
export function canvasFields(value, complete = false) {
  plainObject(value)
  const result = {}
  if (complete) {
    result.id = identifier(value.id, 'element id')
    if (!types.has(value.type)) throw badRequest('Invalid element type')
    result.type = value.type
  }
  for (const [key, item] of Object.entries(value)) {
    if (numeric.has(key)) {
      if (typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1e7) throw badRequest(`Invalid ${key}`)
      if (['width', 'height', 'strokeWidth', 'fontSize', 'cornerRadius'].includes(key) && item < 0) throw badRequest(`Invalid ${key}`)
      if (key === 'opacity' && (item < 0 || item > 1)) throw badRequest('Invalid opacity')
      result[key] = item
    } else if (strings.has(key)) {
      const max = key === 'imageSrc' ? 6_000_000 : key === 'text' ? 20000 : 256
      if (typeof item !== 'string' || item.length > max) throw badRequest(`Invalid or oversized ${key}`)
      if (key === 'imageSrc' && !/^(data:image\/(png|jpeg|webp|gif);base64,|https?:\/\/)/i.test(item)) throw badRequest('Invalid image source')
      result[key] = item
    } else if (key === 'points') {
      if (!Array.isArray(item) || item.length > 100000 || item.length % 2 || item.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e7)) throw badRequest('Invalid points')
      result.points = item
    } else if (key === 'draggable') {
      if (typeof item !== 'boolean') throw badRequest('Invalid draggable')
      result.draggable = item
    }
  }
  return result
}

export function titleValue(value) {
  if (typeof value !== 'string' || value.length > 200) throw badRequest('Title must be at most 200 characters')
  return value.trim() || 'Untitled Board'
}

export function errorResponse(err, req, res, _next) {
  const status = err.status || err.statusCode || (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500)
  if (status >= 500) console.error(`[API] ${req.method} ${req.originalUrl} (${req.id})`, err)
  res.status(status).json({ error: status === 413 ? 'Payload too large (maximum 8 MB)' : status >= 500 ? 'Server error; please try again' : err.message })
}
