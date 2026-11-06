import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeError, logError, logInfo, sanitiseExtra, setLogSink, type LogSink } from './logger.js'

const lines: { level: string; message: string; fields: Record<string, unknown> }[] = []
let restore: () => void
beforeEach(() => {
  restore = setLogSink({
    info: (message, fields) => lines.push({ level: 'info', message, fields }),
    warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
    error: (message, fields) => lines.push({ level: 'error', message, fields }),
  } satisfies LogSink)
})
afterEach(() => {
  restore()
  lines.length = 0
})

describe('structured logging', () => {
  it('carries fn, uid, tenantId, requestId and outcome', () => {
    logInfo({ fn: 'checkIn', uid: 'u1', tenantId: 'T1', requestId: '11111111-1111-4111-8111-111111111111' }, 'ok', { count: 2 })
    expect(lines[0]?.fields).toEqual({
      fn: 'checkIn', outcome: 'ok', uid: 'u1', tenantId: 'T1', requestId: '11111111-1111-4111-8111-111111111111', count: 2,
    })
  })
  it('drops sensitive keys and masks urls, tokens and long blobs', () => {
    const out = sanitiseExtra({
      password: 'hunter2', pin: '123456', fcmToken: 'abc', photoUrl: 'https://x/y.jpg', driverName: 'Dan', phone: '0771234567',
      plateNo: 'WP LJ-4821', note: 'see https://evil.example/a?token=1', blob: 'a'.repeat(80), jwt: 'eyJhbGciOi.x.y', ok: 'fine', n: 3, b: true,
    })
    expect(out).toEqual({ note: '[masked]', blob: '[masked]', jwt: '[masked]', ok: 'fine', n: 3, b: true })
  })
  it('logs errors as name and code only, never the message', () => {
    logError({ fn: 'x' }, Object.assign(new Error('secret 0771234567 failed'), { code: 'unavailable' }))
    expect(lines[0]?.fields).toMatchObject({ outcome: 'error', errorName: 'Error', errorCode: 'unavailable' })
    expect(JSON.stringify(lines)).not.toContain('0771234567')
    expect(describeError('boom')).toEqual({ errorName: 'string' })
  })
})
