import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** WCAG 2.1 A and AA rules (labels, names, roles, contrast, focus, landmarks). Fails with a readable list. */
export async function expectNoAxeViolations(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 4).map((n) => `   ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`).join('\n')}`)
  expect(summary, `${what}: accessibility violations\n${summary.join('\n')}`).toEqual([])
}

/** Visible, interactive elements smaller than 44 x 44 CSS px on a phone (inline text links and hidden inputs are exempt). */
export async function smallTouchTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const MIN = 44
    const nodes = document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=radio], [role=checkbox]')
    const out: string[] = []
    for (const el of nodes) {
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || el.closest('[aria-hidden=true]')) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) continue // visually hidden (a file input behind a visible button)
      // A label that wraps the control is the real target (custom radios and checkboxes).
      const label = el.closest('label')
      const box = label ? label.getBoundingClientRect() : r
      // Text links inside a sentence are exempt (WCAG 2.5.8 inline exception).
      const inline = el.tagName === 'A' && style.display === 'inline' && el.closest('p, li')
      if (inline) continue
      if (box.width < MIN - 0.5 || box.height < MIN - 0.5) {
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName
        out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
    }
    return out
  })
}
