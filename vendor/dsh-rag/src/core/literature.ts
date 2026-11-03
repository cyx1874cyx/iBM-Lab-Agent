import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { SOURCE_ROLES, type SourceRole, type LiteratureMetadata, type LiteratureFilters } from '../shared/literature.ts'
export { SOURCE_ROLES, TOPIC_LABELS } from '../shared/literature.ts'
export type { SourceRole, LiteratureMetadata, LiteratureFilters } from '../shared/literature.ts'

const cache = new Map<string, { mtime: number; byPath: Map<string, LiteratureMetadata> }>()
const text = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 1000) : ''
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 80) : []

/** Only whitelisted bibliography fields leave the local manifest. Absolute paths never become model context. */
export async function readLiteratureMetadata(root: string, relativePath: string): Promise<LiteratureMetadata | undefined> {
  const manifestPath = path.join(root, 'literature-manifest.json')
  let mtime: number
  try { mtime = (await stat(manifestPath)).mtimeMs } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let current = cache.get(root)
  if (current?.mtime !== mtime) {
    const bytes = await readFile(manifestPath)
    if (bytes.length > 16 * 1024 * 1024) throw new Error('literature manifest exceeds size limit')
    const data = JSON.parse(bytes.toString('utf8')) as { papers?: Record<string, unknown>[]; files?: Record<string, unknown>[] }
    if (!Array.isArray(data.papers) || !Array.isArray(data.files)) throw new Error('invalid literature manifest')
    const papers = new Map(data.papers.map(p => [text(p.gid), p]))
    const byPath = new Map<string, LiteratureMetadata>()
    for (const file of data.files) {
      const role = text(file.role)
      if (!SOURCE_ROLES.includes(role as SourceRole)) continue
      const paperId = text(file.paper_id)
      const paper = papers.get(paperId)
      const year = Number(paper?.year)
      byPath.set(text(file.path).replaceAll('\\', '/'), {
        paperId, role: role as SourceRole,
        title: text(paper?.title) || text(file.title),
        doi: text(paper?.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '').toLowerCase(),
        authors: strings(paper?.authors),
        topics: strings(paper?.module_all).length > 0 ? strings(paper?.module_all) : role === 'thesis' ? ['THESIS'] : [],
        ...(Number.isInteger(year) && year >= 1800 && year <= 2200 ? { year } : {}),
        ...(text(paper?.kind) === '' ? {} : { studyType: text(paper?.kind) }),
      })
    }
    current = { mtime, byPath }
    cache.set(root, current)
  }
  return current.byPath.get(relativePath.split(path.sep).join('/'))
}

export function matchesLiterature(metadata: LiteratureMetadata | undefined, filters: LiteratureFilters): boolean {
  if (filters.topics?.length && !metadata?.topics.some(topic => filters.topics?.includes(topic))) return false
  if (filters.roles?.length && (metadata === undefined || !filters.roles.includes(metadata.role))) return false
  if (filters.yearFrom !== undefined && (metadata?.year === undefined || metadata.year < filters.yearFrom)) return false
  if (filters.yearTo !== undefined && (metadata?.year === undefined || metadata.year > filters.yearTo)) return false
  return true
}

const MEDICAL_TERMS: readonly [RegExp, string][] = [
  [/CLOT[\s-]+OUT|Clotild/iu, 'Clotild'],
  [/人体|临床患者/iu, 'human patient'],
  [/电阻抗|阻抗谱|\bEIS\b/iu, 'impedance spectroscopy electrical'],
  [/红细胞|\bRBC\b/iu, 'erythrocyte erythrocytes RBC'],
  [/纤维蛋白/iu, 'fibrin fibrinogen'], [/血小板/iu, 'platelet platelets'],
  [/中性粒细胞胞外|\bNETs?\b/iu, 'neutrophil extracellular traps NETs'],
  [/溶栓/iu, 'thrombolysis thrombolytic alteplase'], [/取栓|机械再通/iu, 'thrombectomy retrieval recanalization'],
  [/首过|首次取通/iu, 'first pass effect FPE'], [/光声/iu, 'photoacoustic optoacoustic'],
  [/超声|弹性成像/iu, 'ultrasound elastography'], [/磁共振/iu, 'MRI magnetic resonance'],
  [/双能|能谱/iu, 'dual energy spectral CT'], [/光子计数/iu, 'photon counting'],
  [/拉曼/iu, 'Raman'], [/漫反射/iu, 'diffuse reflectance'], [/近红外/iu, 'near infrared'],
  [/分子靶向/iu, 'molecular targeted imaging fibrin'], [/收缩/iu, 'contraction compaction'],
  [/异质性|空间结构/iu, 'heterogeneity spatial structure'], [/血管内|术中/iu, 'intravascular in situ'],
  [/病因/iu, 'etiology aetiology'], [/预后/iu, 'outcome prognosis'], [/成分|组成/iu, 'composition'],
]

/** Deterministic bilingual expansion, not a claim of semantic vector retrieval. */
export function expandMedicalQuery(query: string): string {
  return [query, ...MEDICAL_TERMS.filter(([pattern]) => pattern.test(query)).map(([, english]) => english)].join(' ')
}

export function diversifySources<T extends { sourceId: string; literature?: LiteratureMetadata }>(sources: readonly T[], limit: number, maxPerPaper = 2): T[] {
  const counts = new Map<string, number>()
  const result: T[] = []
  for (const source of sources) {
    const key = source.literature?.paperId || source.sourceId
    const count = counts.get(key) ?? 0
    if (count >= maxPerPaper) continue
    counts.set(key, count + 1)
    result.push(source)
    if (result.length >= limit) break
  }
  for (const paperId of new Set(result.map(source => source.literature?.paperId).filter(Boolean))) {
    if (result.some(source => source.literature?.paperId === paperId && source.literature?.role === 'original')) continue
    const original = sources.find(source => source.literature?.paperId === paperId && source.literature?.role === 'original')
    if (original === undefined) continue
    const replacement = result.findLastIndex(source => source.literature?.paperId === paperId)
    if (replacement >= 0) result[replacement] = original
  }
  return result
}
