import type { Category } from '../types/notice.ts'

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'general', label: '教务 · 综合' },
  { id: 'college', label: '书院' },
  { id: 'science', label: '理工学院' },
  { id: 'humanities', label: '人文社科学院' },
]
