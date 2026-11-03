import { realpath } from 'node:fs/promises'
import path from 'node:path'

const DEVICE_OR_UNC = /^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/u

function comparable(value: string): string {
  const normalized = path.resolve(value).normalize('NFC')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(comparable(root), comparable(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export async function authorizeRoot(input: string): Promise<string> {
  const trimmed = input.trim()
  if (trimmed === '' || !path.isAbsolute(trimmed)) throw new Error('authorized root must be an absolute path')
  if (DEVICE_OR_UNC.test(trimmed)) throw new Error('UNC and device paths are not supported')
  return realpath(trimmed)
}

export async function resolveAuthorizedPath(root: string, relativePath: string): Promise<string> {
  if (relativePath === '' || path.isAbsolute(relativePath)) throw new Error('source path must be relative')
  const lexical = path.resolve(root, relativePath)
  if (!isWithinRoot(root, lexical)) throw new Error('source path escapes authorized root')
  const resolvedRoot = await realpath(root)
  const resolvedCandidate = await realpath(lexical)
  if (!isWithinRoot(resolvedRoot, resolvedCandidate)) throw new Error('resolved source escapes authorized root')
  return resolvedCandidate
}
