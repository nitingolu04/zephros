// Keep identical in frontend/src/lib and backend/src/lib (each app deploys from its own folder; a test enforces this).
const fields = ['type', 'x', 'y', 'width', 'height', 'rotation', 'fill', 'stroke', 'strokeWidth', 'text', 'fontSize', 'fontFamily', 'fontStyle', 'textDecoration', 'points', 'opacity', 'cornerRadius', 'draggable', 'imageSrc']
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sameElement = (a, b) => fields.every(key => equal(a[key], b[key]))

export function diffElements(before, after) {
  const previous = new Map(before.map(el => [el.id, el]))
  const next = new Map(after.map(el => [el.id, el]))
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap(id => {
    const a = previous.get(id) || null
    const b = next.get(id) || null
    return a && b && sameElement(a, b) ? [] : [{ id, before: a, after: b }]
  })
}

// Conditional field updates preserve unrelated edits made by collaborators.
export function applyPatches(elements, patches) {
  const next = new Map(elements.map(el => [el.id, { ...el }]))
  for (const { id, before, after } of patches) {
    const current = next.get(id)
    if (!before) {
      if (!current && after) next.set(id, { ...after, id })
    } else if (!after) {
      if (current && sameElement(current, before)) next.delete(id)
    } else if (current) {
      for (const key of fields) {
        if (equal(before[key], after[key]) || !equal(current[key], before[key])) continue
        if (after[key] === undefined) delete current[key]
        else current[key] = after[key]
      }
    }
  }
  return [...next.values()]
}
