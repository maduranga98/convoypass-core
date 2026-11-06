import { describe, expect, it } from 'vitest'
import { driverPhotoPath } from './photoPath'

describe('driverPhotoPath', () => {
  it('matches tenants/{tenantId}/contractors/{contractorId}/drivers/{uid}.jpg', () => {
    expect(driverPhotoPath('acme', 'c1', 'uid123')).toBe('tenants/acme/contractors/c1/drivers/uid123.jpg')
  })
})
