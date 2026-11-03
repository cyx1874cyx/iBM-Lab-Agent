import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { readJsonIfExists, writeJsonAtomic } from './atomic-json.ts'
import type { KnowledgeCatalog } from './knowledge-types.ts'
import { ProviderError, type EmbeddingProvider } from './provider.ts'

interface VectorEntry {
  readonly chunkId: string
  readonly inputHash: string
  readonly vector: readonly number[]
}

interface VectorIndex {
  readonly schemaVersion: 1
  readonly knowledgeBaseId: string
  readonly model: string
  readonly dimensions: number
  readonly catalogGeneration: number
  readonly entries: readonly VectorEntry[]
}

interface VectorManifest {
  readonly schemaVersion: 1
  readonly knowledgeBaseId: string
  readonly activeFile: string
  readonly model: string
  readonly dimensions: number
  readonly catalogGeneration: number
}

export interface VectorSyncResult {
  readonly model: string
  readonly dimensions: number
  readonly embeddedChunks: number
  readonly reusedChunks: number
  readonly rebuiltForDimensionChange: boolean
}

export interface VectorRank {
  readonly chunkId: string
  readonly score: number
}

function modelId(model: string): string {
  return createHash('sha256').update(model).digest('hex').slice(0, 16)
}

function embeddingInputHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function checkedDimensions(vectors: readonly (readonly number[])[]): number {
  const dimensions = vectors[0]?.length
  if (dimensions === undefined || dimensions === 0 || vectors.some(vector => vector.length !== dimensions)) {
    throw new ProviderError('Embedding provider returned inconsistent dimensions', 'BAD_RESPONSE')
  }
  return dimensions
}

export class LocalVectorStore {
  constructor(private readonly storagePath: string) {}

  private basePath(knowledgeBaseId: string): string {
    return path.join(this.storagePath, 'indexes', knowledgeBaseId)
  }

  private manifestPath(knowledgeBaseId: string): string {
    return path.join(this.basePath(knowledgeBaseId), 'manifest.json')
  }

  private async activeIndex(knowledgeBaseId: string): Promise<VectorIndex | undefined> {
    const manifest = await readJsonIfExists<VectorManifest>(this.manifestPath(knowledgeBaseId))
    if (manifest?.schemaVersion !== 1 || manifest.knowledgeBaseId !== knowledgeBaseId || path.basename(manifest.activeFile) !== manifest.activeFile) return undefined
    const index = await readJsonIfExists<VectorIndex>(path.join(this.basePath(knowledgeBaseId), manifest.activeFile))
    if (index?.schemaVersion !== 1 || index.knowledgeBaseId !== knowledgeBaseId) return undefined
    if (index.model !== manifest.model || index.dimensions !== manifest.dimensions) return undefined
    return index
  }

  async sync(
    catalog: KnowledgeCatalog,
    model: string,
    provider: EmbeddingProvider,
    signal?: AbortSignal,
    aiContextByChunkId: ReadonlyMap<string, string> = new Map(),
  ): Promise<VectorSyncResult> {
    if (model.trim() === '') throw new TypeError('embedding model must not be empty')
    const inputs = catalog.documents.flatMap(document => document.chunks.map(chunk => ({
      chunkId: chunk.id,
      text: `${chunk.structuralContext}\n${aiContextByChunkId.get(chunk.id) ?? ''}\n${chunk.text}`,
    })))
    const active = await this.activeIndex(catalog.knowledgeBaseId)
    const compatible = active?.model === model ? active : undefined
    const oldById = new Map(compatible?.entries.map(entry => [entry.chunkId, entry]) ?? [])
    const rows = inputs.map(input => ({ ...input, inputHash: embeddingInputHash(input.text) }))
    if (rows.length === 0) {
      if (compatible === undefined) return { model, dimensions: 0, embeddedChunks: 0, reusedChunks: 0, rebuiltForDimensionChange: false }
      const fileName = `vectors-${modelId(model)}-d${compatible.dimensions}-g${catalog.generation}.json`
      await writeJsonAtomic(path.join(this.basePath(catalog.knowledgeBaseId), fileName), {
        schemaVersion: 1,
        knowledgeBaseId: catalog.knowledgeBaseId,
        model,
        dimensions: compatible.dimensions,
        catalogGeneration: catalog.generation,
        entries: [],
      } satisfies VectorIndex)
      await writeJsonAtomic(this.manifestPath(catalog.knowledgeBaseId), {
        schemaVersion: 1,
        knowledgeBaseId: catalog.knowledgeBaseId,
        activeFile: fileName,
        model,
        dimensions: compatible.dimensions,
        catalogGeneration: catalog.generation,
      } satisfies VectorManifest)
      return { model, dimensions: compatible.dimensions, embeddedChunks: 0, reusedChunks: 0, rebuiltForDimensionChange: false }
    }
    const reusable = rows.filter(row => oldById.get(row.chunkId)?.inputHash === row.inputHash)
    const changed = rows.filter(row => oldById.get(row.chunkId)?.inputHash !== row.inputHash)
    if (changed.length === 0 && compatible !== undefined) {
      return {
        model,
        dimensions: compatible.dimensions,
        embeddedChunks: 0,
        reusedChunks: reusable.length,
        rebuiltForDimensionChange: false,
      }
    }

    const firstVectors = await provider.embed(changed.length === 0 ? rows.map(row => row.text) : changed.map(row => row.text), signal)
    let dimensions = checkedDimensions(firstVectors)
    let rebuiltForDimensionChange = false
    let embeddedRows = changed.length === 0 ? rows : changed
    let vectors = firstVectors
    if (compatible !== undefined && dimensions !== compatible.dimensions) {
      rebuiltForDimensionChange = true
      embeddedRows = rows
      vectors = await provider.embed(rows.map(row => row.text), signal)
      dimensions = checkedDimensions(vectors)
    }
    const generated = new Map(embeddedRows.map((row, index) => [row.chunkId, {
      chunkId: row.chunkId,
      inputHash: row.inputHash,
      vector: vectors[index] ?? [],
    } satisfies VectorEntry]))
    const entries = rows.map(row => generated.get(row.chunkId) ?? oldById.get(row.chunkId)).filter((entry): entry is VectorEntry => entry !== undefined)
    if (entries.length !== rows.length || entries.some(entry => entry.vector.length !== dimensions)) {
      throw new ProviderError('Vector index candidate is incomplete', 'BAD_RESPONSE')
    }
    const fileName = `vectors-${modelId(model)}-d${dimensions}-g${catalog.generation}.json`
    const index: VectorIndex = {
      schemaVersion: 1,
      knowledgeBaseId: catalog.knowledgeBaseId,
      model,
      dimensions,
      catalogGeneration: catalog.generation,
      entries,
    }
    await writeJsonAtomic(path.join(this.basePath(catalog.knowledgeBaseId), fileName), index)
    await writeJsonAtomic(this.manifestPath(catalog.knowledgeBaseId), {
      schemaVersion: 1,
      knowledgeBaseId: catalog.knowledgeBaseId,
      activeFile: fileName,
      model,
      dimensions,
      catalogGeneration: catalog.generation,
    } satisfies VectorManifest)
    return {
      model,
      dimensions,
      embeddedChunks: embeddedRows.length,
      reusedChunks: rows.length - embeddedRows.length,
      rebuiltForDimensionChange,
    }
  }

  async search(knowledgeBaseId: string, model: string, queryVector: readonly number[], limit = 20): Promise<VectorRank[]> {
    const index = await this.activeIndex(knowledgeBaseId)
    if (index === undefined || index.model !== model || queryVector.length !== index.dimensions || limit <= 0) return []
    return index.entries.map(entry => ({ chunkId: entry.chunkId, score: cosine(entry.vector, queryVector) }))
      .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
      .slice(0, limit)
      .map(item => ({ ...item, score: Number(item.score.toFixed(6)) }))
  }

  async clear(knowledgeBaseId: string): Promise<void> {
    if (!/^[0-9a-z-]+$/iu.test(knowledgeBaseId)) throw new Error('invalid knowledge base ID')
    await rm(this.basePath(knowledgeBaseId), { recursive: true, force: true })
  }
}
