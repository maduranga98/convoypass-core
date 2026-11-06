/**
 * Stand-in for the `re2js` regex engine, wired in by vite.config.ts.
 *
 * The Firestore SDK bundles re2js (about 245 KB, roughly 45 KB gzipped) only for the regular-expression functions of
 * its Pipeline API (`regexMatch`, `regexContains`, ...), which this app never calls: it uses classic queries and
 * listeners. Dropping it keeps the first download of the driver and gate screens smaller. If a future SDK starts using
 * the engine for something else, `RE2JS.compile` throws this message and the build or the first use shows it at once.
 */
const unsupported = (): never => {
  throw new Error('Regular-expression pipeline functions are not available in this build (re2js is stubbed, see src/lib/stubs/re2js.ts)')
}

export class RE2JS {
  static compile = unsupported
  static matches = unsupported
  static quote = unsupported
}

export default { RE2JS }
