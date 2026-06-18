export async function exportStageToPdf(
  stageContainer: HTMLElement,
  filename: string,
): Promise<void> {
  const canvases = stageContainer.querySelectorAll('canvas')
  if (canvases.length === 0) throw new Error('Canvas not found')

  const { jsPDF } = await import('jspdf')
  const first = canvases[0] as HTMLCanvasElement
  const scale = 2
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = first.width * scale
  exportCanvas.height = first.height * scale
  const ctx = exportCanvas.getContext('2d')
  if (!ctx) throw new Error('Export failed')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
  ctx.scale(scale, scale)
  canvases.forEach((c) => {
    ctx.drawImage(c as HTMLCanvasElement, 0, 0)
  })

  const imgData = exportCanvas.toDataURL('image/png')
  const pdf = new jsPDF({
    orientation: exportCanvas.width > exportCanvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [exportCanvas.width, exportCanvas.height],
  })
  pdf.addImage(imgData, 'PNG', 0, 0, exportCanvas.width, exportCanvas.height)
  pdf.save(filename)
}
