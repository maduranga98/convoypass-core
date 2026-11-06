import { useMemo, useState } from 'react'

export const PAGE_SIZE = 50

/** Case-insensitive "all words match" over a haystack. */
export function matchesSearch(haystack: string, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const h = haystack.toLowerCase()
  return words.every((w) => h.includes(w))
}

/** Renders the list in steps so 1000 rows (and their photos) are not mounted at once. Resets when the list changes. */
export function usePaged<T>(items: T[], size = PAGE_SIZE) {
  const [paging, setPaging] = useState({ items, count: size })
  // A new list (search, filter, refetch) starts again from the first page.
  if (paging.items !== items) setPaging({ items, count: size })
  const count = paging.items === items ? paging.count : size
  const visible = useMemo(() => items.slice(0, count), [items, count])
  return { visible, hasMore: count < items.length, remaining: items.length - count, showMore: () => setPaging((p) => ({ items, count: p.count + size })) }
}
