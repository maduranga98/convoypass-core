import { FirebaseError } from 'firebase/app'
import { describe, expect, it } from 'vitest'
import { describeLoadError } from './errors'
import { strings } from './strings'

describe('describeLoadError', () => {
  it('names the rules when a read is denied', () => {
    expect(describeLoadError(new FirebaseError('permission-denied', 'Missing or insufficient permissions.'))).toBe(strings.loadErrors.permission)
  })
  it('names a missing index, but not other failed preconditions', () => {
    expect(describeLoadError(new FirebaseError('failed-precondition', 'The query requires an index. You can create it here: https://...'))).toBe(strings.loadErrors.index)
    expect(describeLoadError(new FirebaseError('failed-precondition', 'Something else'))).toBeNull()
  })
  it('reports being offline and an expired session', () => {
    expect(describeLoadError(new FirebaseError('unavailable', 'x'))).toBe(strings.loadErrors.network)
    expect(describeLoadError(new FirebaseError('functions/unauthenticated', 'x'))).toBe(strings.loadErrors.session)
  })
  it('says nothing for errors it does not recognise', () => {
    expect(describeLoadError(new Error('boom'))).toBeNull()
    expect(describeLoadError(null)).toBeNull()
  })
})
