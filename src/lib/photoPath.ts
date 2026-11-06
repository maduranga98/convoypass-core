/** The only Storage path a driver photo may live at; Storage rules and `updateUser` accept exactly this. */
export const driverPhotoPath = (tenantId: string, contractorId: string, uid: string): string =>
  `tenants/${tenantId}/contractors/${contractorId}/drivers/${uid}.jpg`
