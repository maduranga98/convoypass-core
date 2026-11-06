import { z } from '@/lib/zod'
import { normalisePlate } from '@/lib/plate'
import { strings } from '@/lib/strings'
import { VEHICLE_TYPES } from '@/lib/vehicleTypes'

const e = strings.vehicles.errors

/** One schema for the add/edit form and for every CSV row. Mirrors the server-side rules in functions/src/schemas.ts. */
export const vehicleFieldsSchemaFor = (types: readonly string[]) =>
  z.object({
    plateNo: z.string().refine((v) => normalisePlate(v) !== null, e.plate),
    type: z.string().refine((v) => types.includes(v), e.type),
    makeModel: z.string().trim().max(60, e.makeModel),
  })

/** Against the default type list; the tenant's own list is passed to `vehicleFieldsSchemaFor`. */
export const vehicleFieldsSchema = vehicleFieldsSchemaFor(VEHICLE_TYPES)
export type VehicleFields = z.infer<typeof vehicleFieldsSchema>
