// Passwords for operator scripts. A password is NEVER a command-line argument (it would end up in shell history and the
// process list): it is generated and printed once, or read from stdin. Nothing here writes to disk or logs.
import type { Readable } from 'node:stream'
import { isCommonPassword } from '../../functions/src/auth/commonPasswords.ts'
import { randomTempPassword } from '../adminResetCli.ts'

export class SecretError extends Error {}

/** 20 characters from an alphabet without look-alikes (0/O, 1/l/I), `crypto.randomInt`, upper + lower + digit guaranteed. */
export const generatePassword = (length = 20): string => randomTempPassword(length)

/** Everything on stdin up to EOF, minus one trailing newline. Refuses an interactive terminal (nothing was piped in). */
export async function readPasswordFromStdin(stream: Readable & { isTTY?: boolean } = process.stdin): Promise<string> {
  if (stream.isTTY) throw new SecretError('--password-stdin expects the password piped in, e.g.  pass show convoypass/superadmin | npm run … -- --password-stdin')
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)))
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

export function assertPassword(password: string, email: string, minLength: number): void {
  if (password.length < minLength) throw new SecretError(`the password must be at least ${minLength} characters`)
  if (password.length > 128) throw new SecretError('the password must be at most 128 characters')
  if (password.toLowerCase() === email.toLowerCase()) throw new SecretError('the password must not be the email address')
  if (isCommonPassword(password)) throw new SecretError('that password is too common')
}

export const WHY_NO_PASSWORD_FLAG =
  '--password is not accepted: a password on the command line ends up in your shell history and the process list. ' +
  'Let the script generate one (printed once), or pipe it in with --password-stdin.'
