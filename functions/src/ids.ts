import { randomInt } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** `veh_` + 10 random chars [a-z0-9]. Permanent: it is the vehicle's Firestore id and the content of its QR code. */
export const newVehicleId = (): string =>
  `veh_${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`

/** The id of a penalty is chosen by the issuing browser (it needs it to upload the evidence photo first); the server only checks the shape and creates the document with `create()`. */
export const PENALTY_ID_PATTERN = /^pen_[a-z0-9]{10}$/

/** `pty_` + 10 random chars: the id of a penalty type. */
export const newPenaltyTypeId = (): string =>
  `pty_${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`

/** The id of a visit is chosen by the browser (a retried check-in is then recognised and never creates a second visit); the server checks the shape and uses `create()`. */
export const VISIT_ID_PATTERN = /^vis_[a-z0-9]{10}$/

/** The id of an inspection is chosen by the browser (a retry of the same call then creates nothing twice); the server checks the shape and uses `create()`. */
export const INSPECTION_ID_PATTERN = /^insp_[a-z0-9]{10}$/

/** The visit created by a pass check-in has a deterministic id, so a retried or replayed check-in finds the same visit. */
export const visitIdForRequest = (requestId: string): string => `vis_${requestId.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(10, '0').slice(0, 10)}`
