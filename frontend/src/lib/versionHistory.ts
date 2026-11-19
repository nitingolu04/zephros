/**
 * Local version history for boards, stored in IndexedDB on this device.
 * Snapshots are plain element arrays; restoring sends ordinary undo-style patches
 * through the existing socket pipeline, so the backend needs no new endpoint.
 */
import type { CanvasElement } from '@/types'
import { generateId } from '@/lib/utils'

export interface BoardVersion {
  id: string
  boardId: string
  createdAt: number
  label: string
  auto: boolean
  count: number
  elements: CanvasElement[]
}

const DB_NAME = 'zephros-local'
const STORE = 'versions'
const MAX_AUTO_PER_BOARD = 20
const MAX_TOTAL_PER_BOARD = 60

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex('boardId', 'boardId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { dbPromise = null; reject(request.error) }
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

/** Keep only canvas fields so snapshots stay small and restore cleanly. */
function clean(elements: CanvasElement[]): CanvasElement[] {
  return elements.map(el => {
    const copy = { ...el } as CanvasElement & { _id?: unknown; __v?: unknown }
    delete copy._id
    delete copy.__v
    return copy
  })
}

export async function listVersions(boardId: string): Promise<BoardVersion[]> {
  const all = await tx<BoardVersion[]>('readonly', store => store.index('boardId').getAll(boardId))
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveVersion(boardId: string, elements: CanvasElement[], label: string, auto = false): Promise<BoardVersion> {
  const version: BoardVersion = {
    id: generateId(),
    boardId,
    createdAt: Date.now(),
    label: label.trim().slice(0, 80) || (auto ? 'Auto-save' : 'Saved version'),
    auto,
    count: elements.length,
    elements: clean(elements),
  }
  await tx('readwrite', store => store.put(version))
  await prune(boardId)
  return version
}

export async function deleteVersion(id: string): Promise<void> {
  await tx('readwrite', store => store.delete(id))
}

async function prune(boardId: string) {
  const versions = await listVersions(boardId)
  const autos = versions.filter(v => v.auto)
  const excess = [
    ...autos.slice(MAX_AUTO_PER_BOARD),
    ...versions.slice(MAX_TOTAL_PER_BOARD),
  ]
  await Promise.all([...new Set(excess.map(v => v.id))].map(deleteVersion))
}

/** Cheap fingerprint to skip auto-saves when nothing changed. */
export function fingerprint(elements: CanvasElement[]): string {
  let hash = elements.length
  for (const el of elements) {
    const s = `${el.id}|${el.x}|${el.y}|${el.width}|${el.height}|${el.text ?? ''}|${el.points?.length ?? 0}|${el.fill ?? ''}|${el.stroke ?? ''}`
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0
  }
  return String(hash)
}
