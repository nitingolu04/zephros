import { generateId } from '@/lib/utils'
import type { CanvasElement } from '@/types'

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Invalid image'))
    img.src = src
  })
}

export async function createImageElement(
  boardId: string,
  file: File,
  at?: { x: number; y: number },
): Promise<CanvasElement> {
  const imageSrc = await readFileAsDataUrl(file)
  const { width, height } = await loadImageSize(imageSrc)
  const maxW = 480
  const scale = width > maxW ? maxW / width : 1
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const now = new Date().toISOString()
  return {
    id: generateId(),
    boardId,
    type: 'image',
    x: at?.x ?? 80,
    y: at?.y ?? 80,
    width: w,
    height: h,
    imageSrc,
    draggable: true,
    createdAt: now,
    updatedAt: now,
  }
}

export async function createElementsFromPdf(
  boardId: string,
  file: File,
  at?: { x: number; y: number },
): Promise<CanvasElement[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const elements: CanvasElement[] = []
  let offsetY = at?.y ?? 80
  const startX = at?.x ?? 80

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const imageSrc = canvas.toDataURL('image/png')
    const now = new Date().toISOString()
    elements.push({
      id: generateId(),
      boardId,
      type: 'image',
      x: startX,
      y: offsetY,
      width: viewport.width,
      height: viewport.height,
      imageSrc,
      text: `Page ${pageNum}`,
      draggable: true,
      createdAt: now,
      updatedAt: now,
    })
    offsetY += viewport.height + 24
  }

  return elements
}

export function createFrameElement(boardId: string, x: number, y: number, w: number, h: number, label: string): CanvasElement {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    boardId,
    type: 'frame',
    x,
    y,
    width: w,
    height: h,
    text: label || 'Frame',
    stroke: '#6366F1',
    strokeWidth: 2,
    fill: 'rgba(99,102,241,0.06)',
    draggable: true,
    createdAt: now,
    updatedAt: now,
  }
}
