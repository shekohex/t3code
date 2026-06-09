import { EnvironmentId, type EnvironmentId as EnvironmentIdType } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { EnvironmentNotRegisteredError, EnvironmentRegistry } from "../connection/registry.ts";
import {
  type EnvironmentRpcInput,
  type EnvironmentStreamCommandRpcTag,
  type EnvironmentSubscriptionRpcTag,
  type EnvironmentUnaryRpcTag,
  request,
  runStream,
  subscribe,
} from "../rpc/client.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";

interface EnvironmentAtomOptions<Input, A, E, R> {
  readonly label: string;
  readonly execute: (input: Input) => Effect.Effect<A, E, R>;
}

interface EnvironmentQueryAtomOptions<Input, A, E, R> extends EnvironmentAtomOptions<
  Input,
  A,
  E,
  R
> {
  readonly staleTimeMs?: number;
  readonly idleTtlMs?: number;
}

interface EnvironmentSubscriptionAtomOptions<Input, A, E, R> {
  readonly label: string;
  readonly subscribe: (input: Input) => Stream.Stream<A, E, R>;
  readonly idleTtlMs?: number;
}

function environmentRpcKey<Input>(target: {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
}): string {
  return JSON.stringify([target.environmentId, target.input]);
}

function parseEnvironmentRpcKey<Input>(key: string): {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
} {
  const decoded = JSON.parse(key) as [EnvironmentIdType, Input];
  return {
    environmentId: EnvironmentId.make(decoded[0]),
    input: decoded[1],
  };
}

export function runInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | EnvironmentNotRegisteredError,
  EnvironmentRegistry | Exclude<R, EnvironmentSupervisor>
> {
  return EnvironmentRegistry.pipe(
    Effect.flatMap((registry) => registry.run(environmentId, effect)),
  );
}

export function runStreamInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<
  A,
  E | EnvironmentNotRegisteredError,
  EnvironmentRegistry | Exclude<R, EnvironmentSupervisor>
> {
  return Stream.unwrap(
    EnvironmentRegistry.pipe(Effect.map((registry) => registry.runStream(environmentId, stream))),
  );
}

export function followStreamInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, EnvironmentRegistry | Exclude<R, EnvironmentSupervisor>> {
  return Stream.unwrap(
    EnvironmentRegistry.pipe(
      Effect.map((registry) =>
        SubscriptionRef.changes(registry.entries).pipe(
          Stream.map((entries) => Option.fromUndefinedOr(entries.get(environmentId))),
          Stream.changes,
          Stream.switchMap(
            Option.match({
              onNone: () => Stream.empty,
              onSome: () =>
                Stream.catchTag(
                  registry.runStream(environmentId, stream),
                  "EnvironmentNotRegisteredError",
                  () => Stream.empty,
                ),
            }),
          ),
        ),
      ),
    ),
  );
}

function createEnvironmentQueryAtomFamily<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentQueryAtomOptions<Input, A, E, EnvironmentSupervisor | R>,
): (target: {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
}) => Atom.Atom<AsyncResult.AsyncResult<A, E | ER | Error>> {
  const rpcGenerationAtom = Atom.family((environmentId: EnvironmentIdType) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.pipe(
            Effect.map((supervisor) =>
              SubscriptionRef.changes(supervisor.state).pipe(
                Stream.filterMap((state) =>
                  state.phase === "connected" ? Result.succeed(state.generation) : Result.failVoid,
                ),
                Stream.changes,
                Stream.map<number, number | null>((generation) => generation),
              ),
            ),
          ),
        ),
      ),
      { initialValue: null },
    ),
  );
  const family = Atom.family((key: string) => {
    const target = parseEnvironmentRpcKey<Input>(key);
    return runtime
      .atom((get) => {
        const generation = Option.getOrNull(
          AsyncResult.value(get(rpcGenerationAtom(target.environmentId))),
        );
        if (generation === null) {
          return Effect.never;
        }
        return runInEnvironment(target.environmentId, options.execute(target.input));
      })
      .pipe(
        Atom.swr({
          staleTime: options.staleTimeMs ?? 30_000,
          revalidateOnMount: true,
        }),
        Atom.setIdleTTL(options.idleTtlMs ?? 5 * 60_000),
        Atom.withLabel(`${options.label}:${key}`),
      );
  });
  return (target) => family(environmentRpcKey(target));
}

export function createEnvironmentSubscriptionAtomFamily<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentSubscriptionAtomOptions<Input, A, E, EnvironmentSupervisor | R>,
) {
  const family = Atom.family((key: string) => {
    const target = parseEnvironmentRpcKey<Input>(key);
    return runtime
      .atom(followStreamInEnvironment(target.environmentId, options.subscribe(target.input)))
      .pipe(
        Atom.setIdleTTL(options.idleTtlMs ?? 5 * 60_000),
        Atom.withLabel(`${options.label}:${key}`),
      );
  });
  return (target: { readonly environmentId: EnvironmentIdType; readonly input: Input }) =>
    family(environmentRpcKey(target));
}

export function createEnvironmentMutation<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentAtomOptions<Input, A, E, EnvironmentSupervisor | R>,
) {
  return runtime
    .fn<{ readonly environmentId: EnvironmentIdType; readonly input: Input }>()((target) =>
      runInEnvironment(target.environmentId, options.execute(target.input)),
    )
    .pipe(Atom.withLabel(options.label));
}

function createEnvironmentStreamMutation<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly execute: (input: Input) => Stream.Stream<A, E, EnvironmentSupervisor | R>;
  },
) {
  return runtime
    .fn<{ readonly environmentId: EnvironmentIdType; readonly input: Input }>()<
      E | EnvironmentNotRegisteredError,
      A
    >((target) =>
      runStreamInEnvironment(target.environmentId, options.execute(target.input)).pipe(
        Stream.withSpan(options.label),
      ),
    )
    .pipe(Atom.withLabel(options.label));
}

export function createEnvironmentRpcQueryAtomFamily<R, ER, TTag extends EnvironmentUnaryRpcTag>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly staleTimeMs?: number;
    readonly idleTtlMs?: number;
  },
) {
  return createEnvironmentQueryAtomFamily(runtime, {
    label: options.label,
    ...(options.staleTimeMs === undefined ? {} : { staleTimeMs: options.staleTimeMs }),
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    execute: (input: EnvironmentRpcInput<TTag>) => request(options.tag, input),
  });
}

export function createEnvironmentRpcSubscriptionAtomFamily<
  R,
  ER,
  TTag extends EnvironmentSubscriptionRpcTag,
>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly idleTtlMs?: number;
  },
) {
  return createEnvironmentSubscriptionAtomFamily(runtime, {
    label: options.label,
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    subscribe: (input: EnvironmentRpcInput<TTag>) => subscribe(options.tag, input),
  });
}

export function createEnvironmentRpcMutation<R, ER, TTag extends EnvironmentUnaryRpcTag>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
  },
) {
  return createEnvironmentMutation(runtime, {
    label: options.label,
    execute: (input: EnvironmentRpcInput<TTag>) => request(options.tag, input),
  });
}

export function createEnvironmentRpcStreamMutation<
  R,
  ER,
  TTag extends EnvironmentStreamCommandRpcTag,
>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
  },
) {
  return createEnvironmentStreamMutation(runtime, {
    label: options.label,
    execute: (input: EnvironmentRpcInput<TTag>) => runStream(options.tag, input),
  });
}
