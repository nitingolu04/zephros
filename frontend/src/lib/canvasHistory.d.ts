export interface Patch<T> { id: string; before: T | null; after: T | null }
export function diffElements<T extends { id: string }>(before: T[], after: T[]): Patch<T>[]
export function applyPatches<T extends { id: string }>(elements: T[], patches: Patch<T>[]): T[]
