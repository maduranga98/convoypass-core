// Function logs are structured JSON; keep them out of test output (logger.test.ts installs its own sink).
import { setLogSink } from './logger.js'

setLogSink({ info: () => undefined, warn: () => undefined, error: () => undefined })
