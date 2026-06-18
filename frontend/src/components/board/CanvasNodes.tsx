import { useEffect, useState } from 'react'
import { Image as KonvaImage, Group, Rect, Text } from 'react-konva'
import type { CanvasElement } from '@/types'

export function CanvasImageNode({
  el,
  commonProps,
  isSelected,
}: {
  el: CanvasElement
  commonProps: Record<string, unknown>
  isSelected: boolean
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!el.imageSrc) return
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setImage(img)
    img.src = el.imageSrc
  }, [el.imageSrc])

  if (!image) return null

  return (
    <KonvaImage
      key={el.id}
      {...commonProps}
      image={image}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      stroke={isSelected ? '#6366F1' : undefined}
      strokeWidth={isSelected ? 2 : 0}
    />
  )
}

export function CanvasFrameNode({
  el,
  commonProps,
  isSelected,
}: {
  el: CanvasElement
  commonProps: Record<string, unknown>
  isSelected: boolean
}) {
  return (
    <Group key={el.id} {...commonProps} x={el.x} y={el.y}>
      <Rect
        width={el.width || 400}
        height={el.height || 300}
        fill={el.fill || 'rgba(99,102,241,0.06)'}
        stroke={isSelected ? '#6366F1' : (el.stroke || '#6366F1')}
        strokeWidth={isSelected ? 3 : (el.strokeWidth || 2)}
        dash={[12, 6]}
        cornerRadius={8}
      />
      <Rect
        y={-28}
        width={Math.min(200, (el.text?.length || 5) * 9 + 24)}
        height={24}
        fill={el.stroke || '#6366F1'}
        cornerRadius={6}
      />
      <Text
        x={10}
        y={-24}
        text={el.text || 'Frame'}
        fontSize={12}
        fontFamily="Inter"
        fill="#ffffff"
        fontStyle="bold"
      />
    </Group>
  )
}
