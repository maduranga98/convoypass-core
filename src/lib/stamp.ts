const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD HH:mm:ss` in the device's local time. */
export function formatLocalDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** The line burned into the bottom-left corner of every evidence photo. */
export const stampText = (plateNo: string, d: Date): string => `${plateNo}  ${formatLocalDateTime(d)}`
