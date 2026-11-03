export interface ActivationClaim<Payload> {
  readonly payload: Payload
  readonly turn: unknown
}

interface PendingActivation<Payload> {
  readonly messageId: string
  readonly payload: Payload
}

/**
 * Mints an activation for one exact command-created user message and lets one
 * compatibility tool read it. Agent identity, message identity, and turn
 * admission all have to match; a durable boolean is intentionally not used.
 */
export class SingleTurnActivationGate<Agent extends object, Payload> {
  private readonly pending = new WeakMap<Agent, PendingActivation<Payload>>()
  private readonly active = new WeakMap<Agent, ActivationClaim<Payload>>()

  issue(agent: Agent, messageId: string, payload: Payload): void {
    if (messageId.length === 0) throw new Error('activation message id must not be empty')
    this.pending.set(agent, {
      messageId,
      payload,
    })
    this.active.delete(agent)
  }

  enter(agent: Agent, messageIds: readonly string[], turn: unknown): boolean {
    const pending = this.pending.get(agent)
    this.pending.delete(agent)
    this.active.delete(agent)
    if (pending === undefined || !messageIds.includes(pending.messageId)) return false
    this.active.set(agent, {
      payload: pending.payload,
      turn,
    })
    return true
  }

  consume(agent: Agent): ActivationClaim<Payload> | undefined {
    const claim = this.active.get(agent)
    this.active.delete(agent)
    return claim
  }

  clear(agent: Agent): void {
    this.pending.delete(agent)
    this.active.delete(agent)
  }
}
