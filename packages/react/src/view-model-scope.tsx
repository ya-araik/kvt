import { ViewModelOwner, type KvtScope } from "@kvt/core";
import {
  useLayoutEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import { KvtReactContext, useKvtContext } from "./context.js";

class TentativeOwner {
  readonly owner: ViewModelOwner;
  readonly #reportError: (
    error: unknown,
    operation: string,
    context?: Readonly<Record<string, unknown>>,
  ) => void;
  #mounted = false;
  #shutdownStarted = false;

  constructor(
    parentScope: KvtScope,
    id: string,
    reportError: (
      error: unknown,
      operation: string,
      context?: Readonly<Record<string, unknown>>,
    ) => void,
  ) {
    const scope = parentScope.createChild({ id: `view-model-owner:${id}` });
    this.owner = new ViewModelOwner(id, scope);
    this.#reportError = reportError;
    // If React abandons this render, the child scope remains bounded by its
    // parent and is reclaimed during parent shutdown. No timer can safely infer
    // an abandoned concurrent render before React has committed or discarded it.
  }

  mount(): void {
    this.#mounted = true;
  }

  unmount(): void {
    this.#mounted = false;
    queueMicrotask(() => {
      if (!this.#mounted) this.#shutdown("view-model-owner-unmount");
    });
  }

  #shutdown(reason: string): void {
    if (this.#shutdownStarted) return;
    this.#shutdownStarted = true;
    const context = {
      signal: new AbortController().signal,
      reason,
      deadline: undefined,
    };
    void Promise.allSettled([
      this.owner.shutdown(context),
      this.owner.scope.shutdown(context),
    ]).then((results) => {
      const errors = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (errors.length > 0)
        this.#reportError(
          new AggregateError(
            errors.map((result) => result.reason),
            `ViewModel owner ${this.owner.id} shutdown failed`,
          ),
          "owner-unmount",
          { ownerId: this.owner.id },
        );
    });
  }
}

export interface KvtViewModelOwnerProps {
  readonly id: string;
  readonly scope?: KvtScope;
  readonly children: ReactNode;
}

/** Optional local owner boundary. KVT routers create route owners automatically. */
export function KvtViewModelOwner({
  id,
  scope,
  children,
}: KvtViewModelOwnerProps): ReactElement {
  const parent = useKvtContext();
  const parentScope = scope ?? parent.owner.scope;
  const controller = useMemo(
    () =>
      parent.runtime.state !== "running" || parentScope.state !== "active"
        ? undefined
        : new TentativeOwner(parentScope, id, (error, operation, context) =>
            parent.runtime.reportError(error, "view-model", operation, context),
          ),
    [id, parent.runtime, parentScope],
  );

  useLayoutEffect(() => {
    if (!controller) return;
    controller.mount();
    return () => controller.unmount();
  }, [controller]);

  // A final pagehide shutdown may race a last concurrent React render. The
  // runtime is already unavailable, so mounting a new owner cannot be useful.
  if (!controller) return <></>;

  return (
    <KvtReactContext.Provider value={{ ...parent, owner: controller.owner }}>
      {children}
    </KvtReactContext.Provider>
  );
}
