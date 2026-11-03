import { isAbortError, throwIfAborted, type RerankProvider } from './provider.ts'

export interface RankedCandidate {
  readonly id: string
  readonly score: number
}

export interface RerankOutcome {
  readonly ranking: readonly RankedCandidate[]
  readonly reranked: boolean
}

export function reciprocalRankFusion(
  rankings: readonly (readonly RankedCandidate[])[],
  rankConstant = 60,
): RankedCandidate[] {
  if (!Number.isFinite(rankConstant) || rankConstant <= 0) throw new TypeError('rankConstant must be positive')
  const scores = new Map<string, number>()
  for (const ranking of rankings) {
    const seen = new Set<string>()
    ranking.forEach((candidate, index) => {
      if (seen.has(candidate.id)) return
      seen.add(candidate.id)
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + 1 / (rankConstant + index + 1))
    })
  }
  return [...scores].map(([id, score]) => ({ id, score: Number(score.toFixed(9)) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
}

export async function rerankWithFallback(
  query: string,
  candidates: readonly { readonly id: string; readonly text: string }[],
  fallback: readonly RankedCandidate[],
  provider: RerankProvider | undefined,
  limit: number,
  signal?: AbortSignal,
): Promise<RerankOutcome> {
  throwIfAborted(signal)
  if (provider === undefined || candidates.length === 0) return { ranking: fallback.slice(0, limit), reranked: false }
  try {
    const scores = await provider.rerank(query, candidates.map(candidate => candidate.text), Math.min(limit, candidates.length), signal)
    const ranking = scores.map(result => ({
      id: candidates[result.index]?.id ?? '',
      score: result.score,
    })).filter(candidate => candidate.id !== '')
    return ranking.length === 0 ? { ranking: fallback.slice(0, limit), reranked: false } : { ranking, reranked: true }
  } catch (error) {
    throwIfAborted(signal)
    if (isAbortError(error)) throw error
    return { ranking: fallback.slice(0, limit), reranked: false }
  }
}
