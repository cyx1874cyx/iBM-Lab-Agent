import { watch, type FSWatcher } from 'node:fs'

export interface IncrementalWatcherOptions {
  readonly debounceMs?: number
  readonly maxBatchMs?: number
  readonly compensationMs?: number
}

export interface WatchBatch {
  readonly reasons: readonly string[]
  readonly compensation: boolean
}

export class StableIncrementalWatcher {
  private readonly debounceMs: number
  private readonly maxBatchMs: number
  private readonly compensationMs: number
  private readonly pending = new Set<string>()
  private readonly watchers: FSWatcher[] = []
  private timer: NodeJS.Timeout | undefined
  private compensationTimer: NodeJS.Timeout | undefined
  private firstEventAt: number | undefined
  private running: Promise<void> | undefined
  private closed = false
  private started = false

  constructor(
    private readonly roots: readonly string[],
    private readonly synchronize: (batch: WatchBatch) => void | Promise<void>,
    options: IncrementalWatcherOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 250
    this.maxBatchMs = options.maxBatchMs ?? 2_000
    this.compensationMs = options.compensationMs ?? 60_000
  }

  start(): void {
    if (this.closed || this.started) return
    this.started = true
    for (const [index, root] of this.roots.entries()) {
      try {
        const watcher = watch(root, { persistent: false }, (_eventType, fileName) => {
          this.notify(fileName === null ? 'unknown' : fileName.toString())
        })
        watcher.on('error', () => { this.notify(`watcher-error-${index}`, true) })
        this.watchers.push(watcher)
      } catch {
        this.notify(`watcher-start-error-${index}`, true)
      }
    }
    this.compensationTimer = setInterval(() => { this.notify('periodic-compensation', true) }, this.compensationMs)
    this.compensationTimer.unref()
  }

  notify(reason: string, compensation = false): void {
    if (this.closed) return
    this.pending.add(`${compensation ? 'compensate' : 'event'}:${reason}`)
    const now = Date.now()
    this.firstEventAt ??= now
    const elapsed = now - this.firstEventAt
    this.schedule(Math.min(this.debounceMs, Math.max(0, this.maxBatchMs - elapsed)))
  }

  compensate(reason = 'manual-compensation'): void {
    this.notify(reason, true)
  }

  private schedule(delay: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, delay)
    this.timer.unref()
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.running !== undefined) await this.running
    while (this.pending.size > 0 && !this.closed) {
      const reasons = [...this.pending].sort()
      this.pending.clear()
      this.firstEventAt = undefined
      this.running = Promise.resolve(this.synchronize({
        reasons,
        compensation: reasons.some(reason => reason.startsWith('compensate:')),
      }))
      try {
        await this.running
      } finally {
        this.running = undefined
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    await this.flush()
    this.closed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.compensationTimer !== undefined) clearInterval(this.compensationTimer)
    for (const watcher of this.watchers) watcher.close()
    this.watchers.splice(0)
  }
}
