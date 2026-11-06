// eslint-disable-next-line no-restricted-imports -- the one place that may import zod directly
import { z } from 'zod'

/**
 * Zod 4 compiles object schemas with `new Function(...)` when it can, and finds out by trying. Under our Content
 * Security Policy (no 'unsafe-eval') that probe is a reported violation on every page that validates a form, so the
 * compiler is switched off: forms here have a handful of fields, and interpreted parsing is just as fast for them.
 * Import `z` from here, not from 'zod'.
 */
z.config({ jitless: true })

export { z }
