import {
  TaskController,
  type Flow,
  type StateFlow,
  type Subscription,
  type TaskControllerOptions,
  type TaskPolicy,
} from "@kvt/flow";
import { MutableStateFlow } from "@kvt/flow";
import { Diagnostics } from "./diagnostics.js";
import type { ClassIdentifier } from "./di/token.js";
import type { KvtScope } from "./di/scope.js";
import { KvtError } from "./errors.js";
import {
  raceWithAbort,
  shutdownResource,
  type Disposable,
  type ShutdownContext,
  type Shutdownable,
} from "./lifecycle.js";
import type { NoInputUseCase, UseCase } from "./use-case.js";

export type ViewModelState =
  "created" | "starting" | "running" | "start-failed" | "stopping" | "stopped";

export interface ViewModelStartOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
}

export type Collectable<T> = Pick<Flow<T>, "subscribe"> | StateFlow<T>;

/**
 * Renderer-neutral lifetime for work launched by a ViewModel.
 * Every resource is cancelled in reverse ownership order when its ViewModel stops.
 */
export class ViewModelScope implements Shutdownable {
  readonly #controller = new AbortController();
  readonly #resources: unknown[] = [];
  readonly #launches = new Set<Promise<unknown>>();
  #stopped = false;

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  collect<T>(
    flow: Collectable<T>,
    collector: (value: T) => void | Promise<void>,
  ): Subscription {
    this.#assertActive("collect");
    const subscription = flow.subscribe(collector, { signal: this.signal });
    this.#resources.push(subscription);
    return subscription;
  }

  async launch<T>(
    operation: (signal: AbortSignal) => T | Promise<T>,
  ): Promise<T | undefined> {
    this.#assertActive("launch");
    const promise = Promise.resolve().then(() => operation(this.signal));
    this.#launches.add(promise);
    try {
      const result = await raceWithAbort(promise, this.signal);
      return this.signal.aborted ? undefined : result;
    } catch (error) {
      if (this.signal.aborted) return undefined;
      throw error;
    } finally {
      this.#launches.delete(promise);
    }
  }

  /** Executes a use case with this ViewModel's cancellation context. */
  run<T>(useCase: NoInputUseCase<T>): Promise<T | undefined>;
  run<I, T>(
    useCase: [I] extends [void] ? never : UseCase<I, T>,
    input: I,
  ): Promise<T | undefined>;
  run<I, T>(
    useCase: NoInputUseCase<T> | UseCase<I, T>,
    ...input: [] | [I]
  ): Promise<T | undefined> {
    if (input.length === 0) {
      return this.launch((signal) =>
        (useCase as NoInputUseCase<T>).execute({ signal }),
      );
    }
    return this.launch((signal) =>
      (useCase as UseCase<I, T>).execute(input[0], { signal }),
    );
  }

  task<I, T, E = unknown>(
    policy: TaskPolicy,
    operation: (
      input: I,
      signal: AbortSignal,
      generation: number,
    ) => Promise<T>,
    options: Omit<TaskControllerOptions<E>, "policy"> = {},
  ): TaskController<I, T, E> {
    this.#assertActive("task");
    const controller = new TaskController<I, T, E>(
      (input, context) => operation(input, context.signal, context.generation),
      { ...options, policy },
    );
    this.#resources.push({
      dispose: () => controller.cancel("view-model-stopped"),
    });
    return controller;
  }

  own<T extends Disposable | Shutdownable>(resource: T): T {
    this.#assertActive("own");
    this.#resources.push(resource);
    return resource;
  }

  checkpoint(): number {
    return this.#resources.length;
  }

  async rollback(checkpoint: number): Promise<unknown[]> {
    const resources = this.#resources.splice(checkpoint);
    return shutdownResources(resources, {
      signal: new AbortController().signal,
      reason: "view-model-start-failed",
      deadline: undefined,
    });
  }

  async shutdown(context: ShutdownContext): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#controller.abort(context.reason);
    const errors: unknown[] = [];
    if (this.#launches.size > 0) {
      try {
        await raceWithAbort(
          Promise.allSettled([...this.#launches]).then(() => undefined),
          context.signal,
        );
      } catch (error) {
        errors.push(error);
      }
    }
    errors.push(
      ...(await shutdownResources(this.#resources.splice(0), context)),
    );
    if (errors.length > 0)
      throw new AggregateError(errors, "ViewModel scope shutdown failed");
  }

  #assertActive(operation: string): void {
    if (this.#stopped || this.signal.aborted)
      throw new KvtError("ViewModel scope is stopped", {
        code: "KVT_VIEW_MODEL_NOT_ACTIVE",
        subsystem: "view-model",
        operation,
      });
  }
}

export abstract class ViewModel implements Shutdownable {
  readonly #state = new MutableStateFlow<ViewModelState>("created");
  protected readonly viewModelScope = new ViewModelScope();
  #startPromise: Promise<void> | undefined;
  #startController: AbortController | undefined;
  #stopPromise: Promise<void> | undefined;

  get lifecycleState(): StateFlow<ViewModelState> {
    return this.#state.asStateFlow();
  }

  protected onStart(_signal: AbortSignal): void | Promise<void> {}
  protected onStop(_context: ShutdownContext): void | Promise<void> {}

  /** Low-level escape hatch. Prefer viewModelScope.collect/run/launch/task in application code. */
  protected own<T extends Disposable | Shutdownable>(resource: T): T {
    return this.viewModelScope.own(resource);
  }

  /** @internal ViewModelOwner is the lifecycle caller. */
  start(
    signal: AbortSignal,
    options: ViewModelStartOptions = {},
  ): Promise<void> {
    if (this.#state.value === "running") return Promise.resolve();
    if (this.#state.value === "stopped" || this.#state.value === "stopping") {
      return Promise.reject(
        new KvtError("A stopped ViewModel cannot be restarted", {
          code: "KVT_VIEW_MODEL_RESTART_FORBIDDEN",
          subsystem: "view-model",
          operation: "start",
        }),
      );
    }
    if (this.#startPromise) return this.#startPromise;
    const attempts = options.attempts ?? 1;
    const delayMs = options.delayMs ?? 0;
    if (!Number.isSafeInteger(attempts) || attempts < 1)
      throw new RangeError(
        "ViewModel start attempts must be a positive safe integer",
      );
    if (!Number.isFinite(delayMs) || delayMs < 0)
      throw new RangeError("ViewModel start delayMs must be non-negative");
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abort, { once: true });
    this.#startController = controller;
    this.#startPromise = this.#start(controller.signal, attempts, delayMs);
    void this.#startPromise.then(
      () => signal.removeEventListener("abort", abort),
      () => {
        signal.removeEventListener("abort", abort);
        this.#startPromise = undefined;
      },
    );
    return this.#startPromise;
  }

  shutdown(context: ShutdownContext): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#startController?.abort(
      new KvtError("ViewModel stopped during start", {
        code: "KVT_VIEW_MODEL_START_CANCELLED",
        subsystem: "view-model",
        operation: "shutdown",
      }),
    );
    this.#state.set("stopping");
    this.#stopPromise = this.#stop(context);
    return this.#stopPromise;
  }

  async #stop(context: ShutdownContext): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.#startPromise;
    } catch {
      /* Start rollback owns its resources. */
    }
    try {
      await this.onStop(context);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.viewModelScope.shutdown(context);
    } catch (error) {
      errors.push(error);
    }
    this.#state.set("stopped");
    if (errors.length > 0)
      throw new AggregateError(errors, "ViewModel shutdown failed");
  }

  async #start(
    signal: AbortSignal,
    attempts: number,
    delayMs: number,
  ): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      this.#state.set("starting");
      const checkpoint = this.viewModelScope.checkpoint();
      try {
        await raceWithAbort(Promise.resolve(this.onStart(signal)), signal);
        if (this.#state.value === "starting") this.#state.set("running");
        return;
      } catch (error) {
        const cleanupErrors = await this.viewModelScope.rollback(checkpoint);
        if (this.#state.value === "starting") this.#state.set("start-failed");
        if (cleanupErrors.length > 0)
          throw new AggregateError(
            [error, ...cleanupErrors],
            "ViewModel start and rollback failed",
          );
        if (signal.aborted || attempt === attempts) throw error;
        if (delayMs > 0) await abortableDelay(delayMs, signal);
      }
    }
  }
}

export type ViewModelInstanceKey = string | number | symbol;

interface ViewModelEntry<T extends ViewModel = ViewModel> {
  readonly identifier: ClassIdentifier<T>;
  readonly instanceKey: ViewModelInstanceKey;
  readonly value: T;
  readonly scope: KvtScope;
  leases: number;
  committed: boolean;
  cleanupScheduled: boolean;
}

export interface ViewModelLease<T extends ViewModel> extends Disposable {
  readonly value: T;
  readonly committed: boolean;
  commit(signal?: AbortSignal): Promise<T>;
}

export interface ViewModelOwnerInspection {
  readonly id: string;
  readonly stopped: boolean;
  readonly entries: readonly {
    readonly key: string;
    readonly instanceKey: string;
    readonly state: ViewModelState;
    readonly scopeId: string;
    readonly leases: number;
    readonly committed: boolean;
  }[];
}

const defaultInstanceKey = Symbol("kvt.default-view-model-instance");

export class ViewModelOwner implements Shutdownable {
  readonly id: string;
  readonly #scope: KvtScope;
  readonly #diagnostics: Diagnostics;
  readonly #entries = new Map<
    ClassIdentifier<ViewModel>,
    Map<ViewModelInstanceKey, ViewModelEntry>
  >();
  #closed = false;
  #shutdownPromise: Promise<void> | undefined;

  constructor(id: string, scope: KvtScope, diagnostics = new Diagnostics()) {
    this.id = id;
    this.#scope = scope;
    this.#diagnostics = diagnostics;
  }

  get scope(): KvtScope {
    return this.#scope;
  }

  inspect(): ViewModelOwnerInspection {
    return Object.freeze({
      id: this.id,
      stopped: this.#closed,
      entries: Object.freeze(
        [...this.#entries.values()].flatMap((entries) =>
          [...entries.values()].map((entry) =>
            Object.freeze({
              key: entry.identifier.name,
              instanceKey: String(entry.instanceKey),
              state: entry.value.lifecycleState.value,
              scopeId: entry.scope.id,
              leases: entry.leases,
              committed: entry.committed,
            }),
          ),
        ),
      ),
    });
  }

  acquire<T extends ViewModel>(
    identifier: ClassIdentifier<T>,
    options: { readonly key?: ViewModelInstanceKey } = {},
  ): ViewModelLease<T> {
    if (this.#closed)
      throw new KvtError(`ViewModel owner ${this.id} is stopped`, {
        code: "KVT_VIEW_MODEL_OWNER_STOPPED",
        subsystem: "view-model",
        operation: "acquire",
        context: { ownerId: this.id },
      });
    const instanceKey = options.key ?? defaultInstanceKey;
    let entries = this.#entries.get(identifier as ClassIdentifier<ViewModel>);
    if (!entries) {
      entries = new Map();
      this.#entries.set(identifier as ClassIdentifier<ViewModel>, entries);
    }
    let entry = entries.get(instanceKey) as ViewModelEntry<T> | undefined;
    if (!entry) {
      const description = identifier.name || "<anonymous-view-model>";
      const scope = this.#scope.createChild({
        id: `${this.id}:${description}:${String(instanceKey)}`,
      });
      try {
        const value = scope.createViewModel(identifier);
        entry = {
          identifier,
          instanceKey,
          value,
          scope,
          leases: 0,
          committed: false,
          cleanupScheduled: false,
        };
        entries.set(instanceKey, entry);
      } catch (error) {
        void scope.shutdown({
          signal: new AbortController().signal,
          reason: "view-model-factory-failed",
          deadline: undefined,
        });
        throw error;
      }
    }
    entry.leases++;
    return new OwnerLease(entry, this.id, this.#diagnostics, () =>
      this.#release(entry!),
    );
  }

  peek<T extends ViewModel>(
    identifier: ClassIdentifier<T>,
    options: { readonly key?: ViewModelInstanceKey } = {},
  ): T | undefined {
    return this.#entries
      .get(identifier as ClassIdentifier<ViewModel>)
      ?.get(options.key ?? defaultInstanceKey)?.value as T | undefined;
  }

  #release<T extends ViewModel>(entry: ViewModelEntry<T>): void {
    entry.leases = Math.max(0, entry.leases - 1);
    this.#diagnostics.emit("view-model", "lease-release", "success", {
      ownerId: this.id,
      key: entry.identifier.name,
      leases: entry.leases,
    });
    if (!entry.committed && entry.leases === 0 && !entry.cleanupScheduled) {
      entry.cleanupScheduled = true;
      queueMicrotask(() => {
        entry.cleanupScheduled = false;
        if (!entry.committed && entry.leases === 0)
          void this.#removeEntry(entry, "uncommitted-render");
      });
    }
  }

  shutdown(context: ShutdownContext): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#closed = true;
    this.#shutdownPromise = this.#shutdown(context);
    return this.#shutdownPromise;
  }

  async #removeEntry(entry: ViewModelEntry, reason: string): Promise<void> {
    const entries = this.#entries.get(entry.identifier);
    if (entries?.get(entry.instanceKey) !== entry) return;
    entries.delete(entry.instanceKey);
    if (entries.size === 0) this.#entries.delete(entry.identifier);
    const context = {
      signal: new AbortController().signal,
      reason,
      deadline: undefined,
    };
    const results = await Promise.allSettled([
      entry.value.shutdown(context),
      entry.scope.shutdown(context),
    ]);
    const errors = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    if (errors.length > 0)
      throw new AggregateError(
        errors,
        `ViewModel ${entry.identifier.name} cleanup failed`,
      );
  }

  async #shutdown(context: ShutdownContext): Promise<void> {
    const entries = [...this.#entries.values()]
      .flatMap((group) => [...group.values()])
      .reverse();
    this.#entries.clear();
    const errors: unknown[] = [];
    for (const entry of entries) {
      try {
        await entry.value.shutdown(context);
      } catch (error) {
        errors.push(error);
      }
      try {
        await entry.scope.shutdown(context);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(
        errors,
        `ViewModel owner ${this.id} shutdown failed`,
      );
  }
}

class OwnerLease<T extends ViewModel> implements ViewModelLease<T> {
  readonly #entry: ViewModelEntry<T>;
  readonly #ownerId: string;
  readonly #diagnostics: Diagnostics;
  readonly #release: () => void;
  #disposed = false;

  constructor(
    entry: ViewModelEntry<T>,
    ownerId: string,
    diagnostics: Diagnostics,
    release: () => void,
  ) {
    this.#entry = entry;
    this.#ownerId = ownerId;
    this.#diagnostics = diagnostics;
    this.#release = release;
    // An uncommitted lease stays bounded by its ViewModelOwner. React can yield
    // between render and commit for an arbitrary duration, so time-based cleanup
    // would be able to release a valid concurrent render. Owner shutdown remains
    // the deterministic cleanup boundary for an abandoned render.
  }

  get value(): T {
    return this.#entry.value;
  }
  get committed(): boolean {
    return this.#entry.committed;
  }

  async commit(signal = new AbortController().signal): Promise<T> {
    if (this.#disposed)
      throw new KvtError("Cannot commit a released ViewModel lease", {
        code: "KVT_VIEW_MODEL_LEASE_RELEASED",
        subsystem: "view-model",
        operation: "commit",
      });
    await this.#entry.value.start(signal);
    this.#entry.committed = true;
    this.#diagnostics.emit("view-model", "start", "success", {
      ownerId: this.#ownerId,
      key: this.#entry.identifier.name,
    });
    return this.#entry.value;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#release();
  }
}

async function shutdownResources(
  resources: unknown[],
  context: ShutdownContext,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const resource of resources.reverse()) {
    try {
      await shutdownResource(resource, context);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function abortableDelay(
  durationMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
