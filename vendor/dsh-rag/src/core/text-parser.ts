import { createHash } from 'node:crypto'
import path from 'node:path'

import type { KnowledgeChunk, SourceLocator } from './knowledge-types.ts'

const MAX_CHARS = 1200

export interface StructuredBlock {
  readonly text: string
  readonly locator: SourceLocator
}

function chunkId(knowledgeBaseName: string, relativePath: string, index: number, block: StructuredBlock): string {
  return createHash('sha256')
    .update(`${knowledgeBaseName}\0${relativePath.split(path.sep).join('/')}\0${index}\0${block.text}\0${JSON.stringify(block.locator)}`)
    .digest('hex')
    .slice(0, 24)
}

function structuralContext(knowledgeBaseName: string, fileName: string, titles: readonly string[]): string {
  const fields = [`知识库：${knowledgeBaseName}`, `文件：${fileName}`]
  if (titles.length > 0) fields.push(`标题：${titles.join(' > ')}`)
  return fields.join('；')
}

function markdownBlocks(text: string): StructuredBlock[] {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const headings: string[] = []
  const blocks: StructuredBlock[] = []
  let start = 0
  let buffer: string[] = []

  const flush = (lineEnd: number): void => {
    const value = buffer.join('\n').trim()
    if (value !== '') blocks.push({
      text: value,
      locator: { kind: 'text', lineStart: start + 1, lineEnd, titlePath: [...headings] },
    })
    buffer = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(lines[index] ?? '')
    if (heading !== null) {
      flush(index)
      const level = heading[1]?.length ?? 1
      headings.splice(level - 1)
      headings[level - 1] = heading[2] ?? ''
      start = index + 1
      continue
    }
    if (buffer.length === 0) start = index
    if ((lines[index] ?? '').trim() === '' && buffer.some(line => line.trim() !== '')) {
      flush(index)
      start = index + 1
    } else {
      buffer.push(lines[index] ?? '')
    }
  }
  flush(lines.length)
  return blocks
}

function splitBlock(block: StructuredBlock): StructuredBlock[] {
  if (block.text.length <= MAX_CHARS) return [block]
  if (block.locator.kind !== 'text') return [block]
  const values: StructuredBlock[] = []
  const lines = block.text.split('\n')
  let buffer = ''
  let lineStart = block.locator.lineStart
  let line = block.locator.lineStart
  for (const item of lines) {
    const next = buffer === '' ? item : `${buffer}\n${item}`
    if (next.length > MAX_CHARS && buffer !== '') {
      values.push({ text: buffer, locator: { ...block.locator, lineStart, lineEnd: line - 1 } })
      buffer = item
      lineStart = line
    } else {
      buffer = next
    }
    line += 1
  }
  if (buffer !== '') values.push({ text: buffer, locator: { ...block.locator, lineStart, lineEnd: line - 1 } })
  return values
}

export function buildStructuredChunks(
  _documentId: string,
  knowledgeBaseName: string,
  relativePath: string,
  blocks: readonly StructuredBlock[],
): KnowledgeChunk[] {
  const fileName = path.basename(relativePath)
  return blocks.map((block, index) => ({
    id: chunkId(knowledgeBaseName, relativePath, index, block),
    text: block.text,
    structuralContext: structuralContext(knowledgeBaseName, fileName, block.locator.titlePath),
    locator: block.locator,
  }))
}

export function parseTextDocument(
  documentId: string,
  knowledgeBaseName: string,
  relativePath: string,
  text: string,
): KnowledgeChunk[] {
  if (text.includes('\0')) throw new Error('binary content is not accepted as text')
  const blocks = markdownBlocks(text).flatMap(splitBlock)
  return buildStructuredChunks(documentId, knowledgeBaseName, relativePath, blocks)
}
