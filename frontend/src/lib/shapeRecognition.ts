/**
 * Smart Shapes: turns a rough freehand stroke into a clean line, rectangle or circle.
 * Pure geometry on the client — produces ordinary canvas elements the existing
 * backend already accepts, so no server change is needed.
 */

export type RecognizedShape =
  | { type: 'line'; points: [number, number, number, number]; x: number; y: number; width: number; height: number }
  | { type: 'rectangle' | 'circle'; x: number; y: number; width: number; height: number }

const MIN_SIZE = 24 // px; smaller strokes are probably handwriting, so leave them alone

function pathLength(pts: number[]) {
  let len = 0
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
  return len
}

/** Snap near-horizontal / near-vertical lines so diagrams stay tidy. */
function snapLine(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const angle = Math.abs(Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI)
  if (angle < 7 || angle > 173) return [x0, y0, x1, y0]
  if (Math.abs(angle - 90) < 7) return [x0, y0, x0, y1]
  return [x0, y0, x1, y1]
}

export function recognizeShape(points: number[]): RecognizedShape | null {
  const count = points.length / 2
  if (count < 6) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1])
  }
  const w = maxX - minX, h = maxY - minY
  const diag = Math.hypot(w, h)
  if (diag < MIN_SIZE) return null

  const length = pathLength(points)
  const [sx, sy] = [points[0], points[1]]
  const [ex, ey] = [points[points.length - 2], points[points.length - 1]]
  const endGap = Math.hypot(ex - sx, ey - sy)

  // Straight stroke: the ends are almost as far apart as the path is long.
  if (endGap / length > 0.94) {
    const pts = snapLine(sx, sy, ex, ey)
    return { type: 'line', points: pts, x: Math.min(pts[0], pts[2]), y: Math.min(pts[1], pts[3]), width: Math.abs(pts[2] - pts[0]), height: Math.abs(pts[3] - pts[1]) }
  }

  // Only closed loops become rectangles or circles; open scribbles stay freehand.
  if (endGap > Math.max(0.25 * diag, 16)) return null
  if (Math.min(w, h) < MIN_SIZE * 0.6) return null

  const cx = minX + w / 2, cy = minY + h / 2
  const rx = w / 2, ry = h / 2
  let ellipseError = 0, rectError = 0
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1]
    // Distance from the ideal ellipse, normalised so 0 = exactly on it.
    ellipseError += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1)
    // Distance to the nearest bounding-box edge, normalised by the half-size.
    rectError += Math.min(x - minX, maxX - x, y - minY, maxY - y) / Math.min(rx, ry)
  }
  ellipseError /= count
  rectError /= count

  // A real outline is roughly one lap around the shape; zig-zags and scribbles are far longer.
  const lap = (perimeter: number) => length > 0.7 * perimeter && length < 1.45 * perimeter

  if (rectError < ellipseError && rectError < 0.16 && lap(2 * (w + h))) {
    return { type: 'rectangle', x: minX, y: minY, width: w, height: h }
  }
  if (ellipseError < 0.16 && lap(Math.PI * (rx + ry))) {
    // The board's circle element is round, so use the average diameter around the centre.
    const d = (w + h) / 2
    return { type: 'circle', x: cx - d / 2, y: cy - d / 2, width: d, height: d }
  }
  return null
}
