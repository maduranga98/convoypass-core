export type LabelSize = 'large' | 'small'

export interface LabelData {
  id: string
  plateNo: string
  contractorName: string
}

/**
 * Physical layout in millimetres. A4 with 10 mm margins leaves 190 x 277 mm.
 * large: 2 x 3 labels of 90 mm (windscreen). small: 3 x 5 labels of 50 mm.
 */
export const LABEL_SPEC = {
  large: { mm: 90, qr: 56, cols: 2, rows: 3, gap: 2, pad: 3, plateMax: 11, brand: 3.4, small: 3.2, url: 2.9 },
  small: { mm: 50, qr: 29, cols: 3, rows: 5, gap: 2, pad: 2, plateMax: 5.6, brand: 2.2, small: 2.1, url: 1.9 },
} as const

export const labelsPerPage = (size: LabelSize): number => LABEL_SPEC[size].cols * LABEL_SPEC[size].rows

/** Shrinks long plates so they stay on one line: ~0.64 em per character for bold sans. */
export const plateFontMm = (plate: string, size: LabelSize): number => {
  const spec = LABEL_SPEC[size]
  const available = spec.mm - spec.pad * 2 - 2
  return Math.min(spec.plateMax, available / (Math.max(plate.length, 1) * 0.64))
}

export function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size))
  return pages
}
