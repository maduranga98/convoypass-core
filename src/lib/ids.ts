const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
/** Largest multiple of 36 that fits a byte: bytes at or above it are skipped so every character is equally likely. */
const LIMIT = 252

function randomSuffix(): string {
  let id = ''
  while (id.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < LIMIT && id.length < 10) id += ALPHABET[b % ALPHABET.length]
    }
  }
  return id
}

/** `pen_` + 10 random chars [a-z0-9] (crypto). Chosen by the browser so a penalty photo can be uploaded to its own path first. */
export const newPenaltyId = (): string => `pen_${randomSuffix()}`

/** `insp_` + 10 random chars [a-z0-9] (crypto). Chosen by the browser so a retried inspection is recognised and never recorded twice. */
export const newInspectionId = (): string => `insp_${randomSuffix()}`

/** `vis_` + 10 random chars [a-z0-9] (crypto). Chosen by the browser so a retried visit check-in is recognised and never creates a second visit. */
export const newVisitId = (): string => `vis_${randomSuffix()}`
