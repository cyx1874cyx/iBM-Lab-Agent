import path from 'node:path'
import { unzipSync } from 'fflate'

import type { KnowledgeChunk } from './knowledge-types.ts'
import { buildStructuredChunks, type StructuredBlock } from './text-parser.ts'

const MAX_XML_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_SELECTED_XML_BYTES = 64 * 1024 * 1024
const MAX_SELECTED_ENTRIES = 2048

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .replace(/&#(\d+);/gu, (_match, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
}

function xmlTexts(xml: string, tag: 'w:t' | 'a:t'): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gu'))]
    .map(match => decodeXml(match[1] ?? '').trim())
    .filter(Boolean)
}

function safeOfficeXml(bytes: Uint8Array, format: 'docx' | 'pptx'): Record<string, Uint8Array> {
  let selectedSize = 0
  let selectedEntries = 0
  const allowed = format === 'docx'
    ? (name: string): boolean => name === 'word/document.xml'
    : (name: string): boolean => name === 'ppt/presentation.xml'
      || name === 'ppt/_rels/presentation.xml.rels'
      || /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/u.test(name)
      || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/u.test(name)
  return unzipSync(bytes, {
    filter: file => {
      const normalized = file.name.replaceAll('\\', '/')
      if (normalized.startsWith('/') || normalized.split('/').includes('..') || !allowed(normalized)) return false
      if (file.originalSize > MAX_XML_ENTRY_BYTES) throw new Error('Office XML entry exceeds expansion limit')
      selectedEntries += 1
      selectedSize += file.originalSize
      if (selectedEntries > MAX_SELECTED_ENTRIES || selectedSize > MAX_SELECTED_XML_BYTES) {
        throw new Error('Office XML archive exceeds expansion limit')
      }
      return true
    },
  })
}

function parseDocx(documentId: string, knowledgeBaseName: string, relativePath: string, bytes: Uint8Array): KnowledgeChunk[] {
  const files = safeOfficeXml(bytes, 'docx')
  const documentXml = files['word/document.xml']
  if (documentXml === undefined) throw new Error('DOCX is missing word/document.xml')
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(documentXml)
  const headings: string[] = []
  const blocks: StructuredBlock[] = []
  let paragraph = 0
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)) {
    paragraph += 1
    const paragraphXml = match[0]
    const text = xmlTexts(paragraphXml, 'w:t').join(' ').trim()
    if (text === '') continue
    const style = /<w:pStyle(?:\s[^>]*)?w:val="Heading([1-6])"[^>]*\/?\s*>/u.exec(paragraphXml)
    if (style !== null) {
      const level = Number(style[1] ?? '1')
      headings.splice(level - 1)
      headings[level - 1] = text
    }
    blocks.push({
      text,
      locator: { kind: 'docx', paragraphStart: paragraph, paragraphEnd: paragraph, titlePath: [...headings] },
    })
  }
  return buildStructuredChunks(documentId, knowledgeBaseName, relativePath, blocks)
}

function numberedXml(files: Record<string, Uint8Array>, pattern: RegExp): Map<number, string> {
  const values = new Map<number, string>()
  for (const [name, bytes] of Object.entries(files)) {
    const match = pattern.exec(name)
    if (match === null) continue
    values.set(Number(match[1]), new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  return values
}

function decodeUtf8(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? '' : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function presentationSlideOrder(files: Record<string, Uint8Array>, slides: Map<number, string>): number[] {
  const presentation = decodeUtf8(files['ppt/presentation.xml'])
  const relationships = decodeUtf8(files['ppt/_rels/presentation.xml.rels'])
  if (presentation === '' || relationships === '') return [...slides.keys()].sort((left, right) => left - right)
  const byRelationship = new Map<string, number>()
  for (const match of relationships.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="slides\/slide(\d+)\.xml"[^>]*\/?\s*>/gu)) {
    byRelationship.set(match[1] ?? '', Number(match[2]))
  }
  const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/gu)]
    .map(match => byRelationship.get(match[1] ?? ''))
    .filter((value): value is number => value !== undefined && slides.has(value))
  return ordered.length === slides.size ? ordered : [...slides.keys()].sort((left, right) => left - right)
}

function noteNumberForSlide(files: Record<string, Uint8Array>, slideFileNumber: number): number | undefined {
  const relationships = decodeUtf8(files[`ppt/slides/_rels/slide${slideFileNumber}.xml.rels`])
  const match = /<Relationship\b[^>]*\bTarget="\.\.\/notesSlides\/notesSlide(\d+)\.xml"[^>]*\/?\s*>/u.exec(relationships)
  return match === null ? undefined : Number(match[1])
}

function parsePptx(documentId: string, knowledgeBaseName: string, relativePath: string, bytes: Uint8Array): KnowledgeChunk[] {
  const files = safeOfficeXml(bytes, 'pptx')
  const slides = numberedXml(files, /^ppt\/slides\/slide(\d+)\.xml$/u)
  const notes = numberedXml(files, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/u)
  if (slides.size === 0) throw new Error('PPTX has no slides')
  const blocks: StructuredBlock[] = []
  const orderedSlides = presentationSlideOrder(files, slides)
  for (const [index, slideFileNumber] of orderedSlides.entries()) {
    const slideTexts = xmlTexts(slides.get(slideFileNumber) ?? '', 'a:t')
    const noteNumber = noteNumberForSlide(files, slideFileNumber) ?? slideFileNumber
    const noteTexts = xmlTexts(notes.get(noteNumber) ?? '', 'a:t')
      .filter(value => !/^\d+$/u.test(value) && value !== '‹#›')
    const text = [...slideTexts, ...noteTexts.map(value => `备注：${value}`)].join('\n').trim()
    if (text === '') continue
    const title = slideTexts[0]
    blocks.push({
      text,
      locator: { kind: 'pptx', slide: index + 1, hasNotes: noteTexts.length > 0, titlePath: title === undefined ? [] : [title] },
    })
  }
  return buildStructuredChunks(documentId, knowledgeBaseName, relativePath, blocks)
}

export function parseOfficeDocument(
  documentId: string,
  knowledgeBaseName: string,
  relativePath: string,
  bytes: Uint8Array,
): KnowledgeChunk[] {
  const extension = path.extname(relativePath).toLocaleLowerCase('en-US')
  if (extension === '.docx') return parseDocx(documentId, knowledgeBaseName, relativePath, bytes)
  if (extension === '.pptx') return parsePptx(documentId, knowledgeBaseName, relativePath, bytes)
  throw new Error('unsupported Office document type')
}
