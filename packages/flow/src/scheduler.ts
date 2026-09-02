export interface ScheduledTask {
  readonly cancelled: boolean
  cancel(): void
}

export interface Scheduler {
  readonly now: number
  schedule(task: () => void, delayMs?: number): ScheduledTask
  sleep(delayMs: number, signal?: AbortSignal): Promise<void>
}

class TimerTask implements ScheduledTask {
  #cancelled = false
  readonly #cancel: () => void

  constructor(cancel: () => void) {
    this.#cancel = cancel
  }

  get cancelled(): boolean {
    return this.#cancelled
  }

  cancel(): void {
    if (this.#cancelled) return
    this.#cancelled = true
    this.#cancel()
  }
}

function abortableSleep(schedule: (task: () => void) => ScheduledTask, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const scheduled = schedule(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    })
    const abort = () => {
      scheduled.cancel()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export const immediateScheduler: Scheduler = {
  get now() {
    return Date.now()
  },
  schedule(task, delayMs = 0) {
    if (delayMs > 0) return timeoutScheduler.schedule(task, delayMs)
    task()
    return new TimerTask(() => undefined)
  },
  sleep(delayMs, signal) {
    return abortableSleep((task) => this.schedule(task, delayMs), signal)
  }
}

export const microtaskScheduler: Scheduler = {
  get now() {
    return Date.now()
  },
  schedule(task, delayMs = 0) {
    if (delayMs > 0) return timeoutScheduler.schedule(task, delayMs)
    let active = true
    queueMicrotask(() => {
      if (active) task()
    })
    return new TimerTask(() => {
      active = false
    })
  },
  sleep(delayMs, signal) {
    return abortableSleep((task) => this.schedule(task, delayMs), signal)
  }
}

export const timeoutScheduler: Scheduler = {
  get now() {
    return Date.now()
  },
  schedule(task, delayMs = 0) {
    const handle = setTimeout(task, Math.max(0, delayMs))
    return new TimerTask(() => clearTimeout(handle))
  },
  sleep(delayMs, signal) {
    return abortableSleep((task) => this.schedule(task, delayMs), signal)
  }
}

export const animationFrameScheduler: Scheduler = {
  get now() {
    return typeof performance === 'undefined' ? Date.now() : performance.now()
  },
  schedule(task, delayMs = 0) {
    if (delayMs > 0) return timeoutScheduler.schedule(task, delayMs)
    if (typeof requestAnimationFrame === 'undefined') return timeoutScheduler.schedule(task)
    const handle = requestAnimationFrame(() => task())
    return new TimerTask(() => cancelAnimationFrame(handle))
  },
  sleep(delayMs, signal) {
    return abortableSleep((task) => this.schedule(task, delayMs), signal)
  }
}

interface VirtualEntry {
  readonly id: number
  readonly at: number
  readonly task: () => void
  cancelled: boolean
}

export class VirtualScheduler implements Scheduler {
  #now = 0
  #nextId = 0
  readonly #queue: VirtualEntry[] = []

  get now(): number {
    return this.#now
  }

  get pendingTaskCount(): number {
    return this.#queue.filter((entry) => !entry.cancelled).length
  }

  schedule(task: () => void, delayMs = 0): ScheduledTask {
    const entry: VirtualEntry = {
      id: this.#nextId++,
      at: this.#now + Math.max(0, delayMs),
      task,
      cancelled: false
    }
    this.#queue.push(entry)
    this.#queue.sort((left, right) => left.at - right.at || left.id - right.id)
    return new TimerTask(() => {
      entry.cancelled = true
    })
  }

  sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    return abortableSleep((task) => this.schedule(task, delayMs), signal)
  }

  advanceBy(durationMs: number): void {
    this.advanceTo(this.#now + Math.max(0, durationMs))
  }

  advanceTo(targetTime: number): void {
    if (targetTime < this.#now) throw new RangeError('Virtual time cannot move backwards')
    while (true) {
      const entry = this.#queue.find((candidate) => !candidate.cancelled && candidate.at <= targetTime)
      if (!entry) break
      this.#queue.splice(this.#queue.indexOf(entry), 1)
      this.#now = entry.at
      entry.task()
    }
    this.#now = targetTime
  }

  runAll(): void {
    while (this.#queue.some((entry) => !entry.cancelled)) {
      const next = this.#queue.find((entry) => !entry.cancelled)
      if (!next) break
      this.advanceTo(next.at)
    }
  }
}
