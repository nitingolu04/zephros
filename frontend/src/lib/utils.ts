import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export function generateUsername(): string {
  const adjectives = ['Swift', 'Bright', 'Calm', 'Bold', 'Keen', 'Wise', 'Cool', 'Warm', 'Neat', 'Fair']
  const nouns = ['Fox', 'Owl', 'Bear', 'Deer', 'Hawk', 'Wolf', 'Lynx', 'Dove', 'Hare', 'Wren']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const num = Math.floor(Math.random() * 999)
  return `${adj}${noun}${num}`
}

export function generateColor(): string {
  const colors = [
    '#D9480F', '#0F766E', '#B45309', '#DB2777', '#E11D48',
    '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#06B6D4',
    '#3B82F6', '#2563EB',
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

export function formatTimeAgo(date: Date | string): string {
  const now = new Date()
  const then = new Date(date)
  const diff = Math.floor((now.getTime() - then.getTime()) / 1000)

  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
