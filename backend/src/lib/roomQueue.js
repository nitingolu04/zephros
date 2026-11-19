const queues = new Map()

// Serialize board writes across sockets so add/update/undo cannot overtake each other.
export function inRoom(boardId, work) {
  const next = (queues.get(boardId) || Promise.resolve()).catch(() => {}).then(work)
  queues.set(boardId, next)
  void next.finally(() => {
    if (queues.get(boardId) === next) queues.delete(boardId)
  }).catch(() => {})
  return next
}
