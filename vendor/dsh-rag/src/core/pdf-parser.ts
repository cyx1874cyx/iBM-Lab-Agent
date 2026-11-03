import path from 'node:path'

import type { KnowledgeChunk } from './knowledge-types.ts'
import { buildStructuredChunks, type StructuredBlock } from './text-parser.ts'

const MAX_PAGES = 5_000
const MAX_PAGE_TEXT_CHARS = 4 * 1024 * 1024
const MAX_DOCUMENT_TEXT_CHARS = 64 * 1024 * 1024
const MAX_CHUNK_CHARS = 1_200

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function pageText(items: readonly unknown[]): string {
  const rows: string[][] = []
  let row: string[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('str' in item) || typeof item.str !== 'string') continue
    const value = item.str.trim()
    if (value !== '') row.push(value)
    if ('hasEOL' in item && item.hasEOL === true) {
      if (row.length > 0) rows.push(row)
      row = []
    }
  }
  if (row.length > 0) rows.push(row)
  const normalized = rows
    .map(parts => parts.map(value => value.replace(/^[-•]\s+/u, '').trim()).filter(Boolean))
    .filter(parts => parts.length > 0 && !/^Page\s+\d+\s+of\s+\d+$/iu.test(parts.join(' ')))
  const tableHeader = normalized.findIndex(parts => /^Parameter\s+Required value$/iu.test(parts.join(' ')))
  if (tableHeader >= 0) {
    const tableValues = normalized.slice(tableHeader + 1)
    const tableRows: string[] = []
    for (const parts of tableValues) {
      const [label, ...values] = parts
      if (label !== undefined) tableRows.push(values.length === 0 ? label : `${label}: ${values.join(' ')}`)
    }
    return [...normalized.slice(0, tableHeader).map(parts => parts.join(' ')), ...tableRows].join('\n').trim()
  }
  return normalized.map(parts => parts.join(' ')).join('\n').trim()
}

function splitPage(text: string, page: number): StructuredBlock[] {
  const lines = text.split('\n')
  const title = lines.find(line => line.trim() !== '' && line.length <= 160)
  const titlePath = title === undefined ? [] : [title]
  const blocks: StructuredBlock[] = []
  let buffer = ''
  for (const line of lines) {
    const next = buffer === '' ? line : `${buffer}\n${line}`
    if (next.length > MAX_CHUNK_CHARS && buffer !== '') {
      blocks.push({ text: buffer, locator: { kind: 'pdf', page, titlePath } })
      buffer = line
    } else {
      buffer = next
    }
  }
  if (buffer.trim() !== '') blocks.push({ text: buffer, locator: { kind: 'pdf', page, titlePath } })
  return blocks
}

export async function parsePdfDocument(
  documentId: string,
  knowledgeBaseName: string,
  relativePath: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<KnowledgeChunk[]> {
  if (path.extname(relativePath).toLocaleLowerCase('en-US') !== '.pdf') throw new Error('unsupported PDF document type')
  if (signalAborted(signal)) throw new DOMException('PDF parsing aborted', 'AbortError')
  // iBM Lab: lazy text-only runtime, with a real JS DOMMatrix polyfill on Node.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    stopAtErrors: true,
    maxImageSize: 0,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    enableHWA: false,
    verbosity: 0,
  })
  const abort = (): void => { void loadingTask.destroy() }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const document = await loadingTask.promise
    if (document.numPages > MAX_PAGES) throw new Error('PDF exceeds page limit')
    const blocks: StructuredBlock[] = []
    const referencePages = new Set<number>()
    let referencesStarted = false
    let totalChars = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signalAborted(signal)) throw new DOMException('PDF parsing aborted', 'AbortError')
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false })
        const text = pageText(content.items)
        if (text.length > MAX_PAGE_TEXT_CHARS) throw new Error('PDF page text exceeds limit')
        totalChars += text.length
        if (totalChars > MAX_DOCUMENT_TEXT_CHARS) throw new Error('PDF document text exceeds limit')
        if (/^\s*(?:references|参考文献)\s*$/imu.test(text)) referencesStarted = true
        if (/^\s*(?:appendix|supplementary (?:material|information)|supporting information)\s*$/imu.test(text)) referencesStarted = false
        if (referencesStarted) referencePages.add(pageNumber)
        blocks.push(...splitPage(text.replace(/([a-z])-\n\s*([a-z])/giu, '$1$2'), pageNumber))
      } finally {
        page.cleanup()
      }
    }
    if (blocks.length === 0) throw new Error('PDF contains no extractable text')
    return buildStructuredChunks(documentId, knowledgeBaseName, relativePath, blocks).map(chunk => ({ ...chunk, sectionKind: chunk.locator.kind === 'pdf' && referencePages.has(chunk.locator.page) ? 'references' as const : 'body' as const }))
  } catch (error) {
    if (signalAborted(signal)) throw new DOMException('PDF parsing aborted', 'AbortError')
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    await loadingTask.destroy()
  }
}
