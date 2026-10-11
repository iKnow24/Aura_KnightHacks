import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Joins class names and lets a later Tailwind class win. Used by shared UI controls.
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
