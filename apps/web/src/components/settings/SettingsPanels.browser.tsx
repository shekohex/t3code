import "../../index.css";

import {
  type AuthAccessStreamEvent,
  type AuthAccessSnapshot,
  type AuthEnvironmentScope,
  AuthSessionId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type DesktopBridge,
  type DesktopUpdateChannel,
  type DesktopUpdateState,
  type LocalApi,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerConfig,
  type ServerProcessResourceHistoryResult,
  type ServerProvider,
  type SourceControlDiscoveryResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { __resetLocalApiForTests } from "../../localApi";
import {
  appAtomRegistry,
  AppAtomRegistryProvider,
  resetAppAtomRegistryForTests,
} from "../../rpc/atomRegistry";
import { useUiStateStore } from "../../uiStateStore";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { DiagnosticsSettingsPanel } from "./DiagnosticsSettings";
import { GeneralSettingsPanel, ProviderSettingsPanel } from "./SettingsPanels";
import { SourceControlSettingsPanel } from "./SourceControlSettings";

function renderWithTestRouter(children: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => children,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return render(<RouterProvider router={router} />);
}

const authAccessHarness = vi.hoisted(() => {
  type Snapshot = AuthAccessSnapshot;
  let snapshot: Snapshot = {
    pairingLinks: [],
    clientSessions: [],
  };
  let revision = 1;
  let currentEvent: AuthAccessStreamEvent = {
    version: 1,
    revision,
    type: "snapshot",
    payload: snapshot,
  };
  const listeners = new Set<() => void>();

  const emitEvent = (event: AuthAccessStreamEvent) => {
    currentEvent = event;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    reset() {
      snapshot = {
        pairingLinks: [],
        clientSessions: [],
      };
      revision = 1;
      currentEvent = {
        version: 1,
        revision,
        type: "snapshot",
        payload: snapshot,
      };
      listeners.clear();
    },
    setSnapshot(next: Snapshot) {
      snapshot = next;
      currentEvent = {
        version: 1,
        revision,
        type: "snapshot",
        payload: snapshot,
      };
    },
    emitSnapshot() {
      emitEvent({
        version: 1 as const,
        revision,
        type: "snapshot" as const,
        payload: snapshot,
      });
      revision += 1;
    },
    emitEvent,
    emitPairingLinkUpserted(pairingLink: Snapshot["pairingLinks"][number]) {
      emitEvent({
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: pairingLink,
      });
      revision += 1;
    },
    emitPairingLinkRemoved(id: string) {
      emitEvent({
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id },
      });
      revision += 1;
    },
    emitClientUpserted(clientSession: Snapshot["clientSessions"][number]) {
      emitEvent({
        version: 1,
        revision,
        type: "clientUpserted",
        payload: clientSession,
      });
      revision += 1;
    },
    emitClientRemoved(sessionId: string) {
      emitEvent({
        version: 1,
        revision,
        type: "clientRemoved",
        payload: {
          sessionId: AuthSessionId.make(sessionId),
        },
      });
      revision += 1;
    },
    getSnapshot() {
      return currentEvent;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

const mockConnectDesktopSshEnvironment = vi.hoisted(() => vi.fn());
const mockGetClerkToken = vi.hoisted(() => vi.fn(async () => null));
const mockConnectPairingEnvironment = vi.hoisted(() => vi.fn());
const mockConnectRelayEnvironment = vi.hoisted(() => vi.fn());
const mockRemoveEnvironment = vi.hoisted(() => vi.fn());
const mockRetryEnvironment = vi.hoisted(() => vi.fn());
const mockRefreshRelayEnvironments = vi.hoisted(() => vi.fn(async () => undefined));
const mockRefreshProviders = vi.hoisted(() =>
  vi.fn(async ({ input }: { readonly input: Record<string, never> }) => {
    return window.nativeApi?.server.refreshProviders(input);
  }),
);
const mockUpdateProvider = vi.hoisted(() =>
  vi.fn(
    async ({ input }: { readonly input: Parameters<LocalApi["server"]["updateProvider"]>[0] }) => {
      return window.nativeApi?.server.updateProvider(input);
    },
  ),
);
const directAtomMocks = vi.hoisted(() => ({
  authAccessQuery: Symbol("auth-access-query"),
  openInEditorAction: Symbol("open-in-editor-action"),
  refreshProvidersAction: Symbol("refresh-providers-action"),
  signalProcessAction: Symbol("signal-process-action"),
  updateProviderAction: Symbol("update-provider-action"),
}));
const serverConfigHarness = vi.hoisted(() => ({
  configAtom: null as unknown,
}));

function setServerConfigSnapshot(config: ServerConfig): void {
  appAtomRegistry.set(serverConfigHarness.configAtom as never, config as never);
}

function resetServerConfigSnapshot(): void {
  appAtomRegistry.set(serverConfigHarness.configAtom as never, null as never);
}

vi.mock("@effect/atom-react", async () => {
  const actual = await vi.importActual<typeof import("@effect/atom-react")>("@effect/atom-react");

  return {
    ...actual,
    useAtomSet: (atom: unknown, options: unknown) => {
      if (atom === directAtomMocks.refreshProvidersAction) {
        return mockRefreshProviders;
      }
      if (atom === directAtomMocks.updateProviderAction) {
        return mockUpdateProvider;
      }
      if (atom === directAtomMocks.signalProcessAction) {
        return async ({
          input,
        }: {
          readonly input: Parameters<LocalApi["server"]["signalProcess"]>[0];
        }) => window.nativeApi?.server.signalProcess(input);
      }
      if (atom === directAtomMocks.openInEditorAction) {
        return async ({
          input,
        }: {
          readonly input: {
            readonly cwd: string;
            readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
          };
        }) => window.nativeApi?.shell.openInEditor(input.cwd, input.editor);
      }
      return actual.useAtomSet(atom as never, options as never);
    },
  };
});

vi.mock("@clerk/react", () => ({
  useAuth: () => ({
    getToken: mockGetClerkToken,
    isSignedIn: false,
  }),
}));

vi.mock("../../cloud/linkEnvironmentAtoms", async () => {
  const Effect = await import("effect/Effect");
  const { Atom } = await import("effect/unstable/reactivity");

  return {
    linkPrimaryEnvironment: Atom.fn(() => Effect.void),
    unlinkPrimaryEnvironment: Atom.fn(() => Effect.void),
  };
});

vi.mock("../../lib/archivedThreadsState", () => ({
  refreshArchivedThreadsForEnvironment: vi.fn(),
  useArchivedThreadSnapshots: () => ({
    snapshots: [],
    error: null,
    isLoading: false,
    refresh: vi.fn(),
  }),
}));

const sourceControlDiscoveryQueryAtom = vi.hoisted(() => Symbol("source-control-discovery-query"));
const serverQueryKinds = {
  processDiagnostics: "process-diagnostics",
  processResourceHistory: "process-resource-history",
  traceDiagnostics: "trace-diagnostics",
} as const;

type ServerQueryMarker =
  | {
      readonly kind: typeof serverQueryKinds.processDiagnostics;
    }
  | {
      readonly kind: typeof serverQueryKinds.processResourceHistory;
      readonly input: Parameters<LocalApi["server"]["getProcessResourceHistory"]>[0];
    }
  | {
      readonly kind: typeof serverQueryKinds.traceDiagnostics;
    };

function isServerQueryMarker(atom: unknown): atom is ServerQueryMarker {
  if (typeof atom !== "object" || atom === null || !("kind" in atom)) {
    return false;
  }
  return Object.values(serverQueryKinds).includes(
    (atom as { readonly kind: ServerQueryMarker["kind"] }).kind,
  );
}

vi.mock("../../state/sourceControl", async () => {
  const actual = await vi.importActual<typeof import("../../state/sourceControl")>(
    "../../state/sourceControl",
  );
  return {
    ...actual,
    sourceControlEnvironment: {
      ...actual.sourceControlEnvironment,
      discovery: () => sourceControlDiscoveryQueryAtom,
    },
  };
});

vi.mock("../../state/query", async () => {
  const React = await import("react");
  const actual = await vi.importActual<typeof import("../../state/query")>("../../state/query");
  type Snapshot = {
    readonly data: SourceControlDiscoveryResult | null;
    readonly error: string | null;
    readonly isPending: boolean;
    readonly refresh: () => void;
  };
  type State = {
    snapshot: Snapshot;
    started: boolean;
    readonly listeners: Set<() => void>;
  };
  const disabledSnapshot: Snapshot = {
    data: null,
    error: null,
    isPending: false,
    refresh: () => undefined,
  };
  const states = new WeakMap<LocalApi, State>();

  const stateFor = (api: LocalApi): State => {
    const existing = states.get(api);
    if (existing) {
      return existing;
    }
    const listeners = new Set<() => void>();
    const state: State = {
      started: false,
      listeners,
      snapshot: {
        data: null,
        error: null,
        isPending: true,
        refresh: () => {
          state.started = false;
          start(state, api);
        },
      },
    };
    states.set(api, state);
    return state;
  };

  const publish = (state: State, next: Omit<Snapshot, "refresh">) => {
    state.snapshot = {
      ...next,
      refresh: state.snapshot.refresh,
    };
    for (const listener of state.listeners) {
      listener();
    }
  };

  const start = (state: State, api: LocalApi) => {
    if (state.started) {
      return;
    }
    state.started = true;
    publish(state, {
      data: state.snapshot.data,
      error: null,
      isPending: true,
    });
    void api.server.discoverSourceControl().then(
      (data) =>
        publish(state, {
          data,
          error: null,
          isPending: false,
        }),
      (error) =>
        publish(state, {
          data: state.snapshot.data,
          error: error instanceof Error ? error.message : String(error),
          isPending: false,
        }),
    );
  };

  const useSourceControlDiscoveryQuery = (enabled: boolean) => {
    const api = enabled ? window.nativeApi : undefined;
    const state = React.useMemo(() => (api ? stateFor(api) : null), [api]);
    const snapshot = React.useSyncExternalStore(
      React.useCallback(
        (listener) => {
          state?.listeners.add(listener);
          return () => {
            state?.listeners.delete(listener);
          };
        },
        [state],
      ),
      React.useCallback(() => state?.snapshot ?? disabledSnapshot, [state]),
    );
    React.useEffect(() => {
      if (state && api) {
        start(state, api);
      }
    }, [api, state]);
    return snapshot;
  };

  const useNativeQuery = <A,>(
    enabled: boolean,
    load: () => Promise<A> | undefined,
    dependencies: React.DependencyList,
  ) => {
    const [state, setState] = React.useState<{
      readonly data: A | null;
      readonly error: string | null;
      readonly isPending: boolean;
    }>({
      data: null,
      error: null,
      isPending: enabled,
    });
    const refresh = React.useCallback(async () => {
      if (!enabled) {
        return;
      }
      setState((current) => ({ ...current, isPending: true }));
      try {
        const data = await load();
        setState({
          data: data ?? null,
          error: null,
          isPending: false,
        });
      } catch (error) {
        setState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          isPending: false,
        });
      }
    }, [enabled, ...dependencies]);
    React.useEffect(() => {
      if (enabled) {
        void refresh();
      }
    }, [enabled, refresh]);
    return { ...state, refresh };
  };

  return {
    ...actual,
    useEnvironmentQuery: (atom: unknown) => {
      const isSourceControlDiscovery = atom === sourceControlDiscoveryQueryAtom;
      const isAuthAccess = atom === directAtomMocks.authAccessQuery;
      const serverQuery = isServerQueryMarker(atom) ? atom : null;
      const isMockedQuery = isSourceControlDiscovery || isAuthAccess || serverQuery !== null;
      const query = actual.useEnvironmentQuery(isMockedQuery ? null : (atom as never));
      const sourceControlDiscovery = useSourceControlDiscoveryQuery(isSourceControlDiscovery);
      const authAccessEvent = React.useSyncExternalStore(
        authAccessHarness.subscribe,
        authAccessHarness.getSnapshot,
        authAccessHarness.getSnapshot,
      );
      const traceDiagnostics = useNativeQuery(
        serverQuery?.kind === serverQueryKinds.traceDiagnostics,
        () => window.nativeApi?.server.getTraceDiagnostics(),
        [],
      );
      const processDiagnostics = useNativeQuery(
        serverQuery?.kind === serverQueryKinds.processDiagnostics,
        () => window.nativeApi?.server.getProcessDiagnostics(),
        [],
      );
      const resourceInput =
        serverQuery?.kind === serverQueryKinds.processResourceHistory ? serverQuery.input : null;
      const processResourceHistory = useNativeQuery(
        resourceInput !== null,
        () =>
          resourceInput === null
            ? Promise.resolve(undefined)
            : window.nativeApi?.server.getProcessResourceHistory(resourceInput),
        [resourceInput?.windowMs, resourceInput?.bucketMs],
      );

      if (isSourceControlDiscovery) {
        return sourceControlDiscovery;
      }
      if (isAuthAccess) {
        return {
          data: authAccessEvent,
          error: null,
          isPending: false,
          refresh: () => undefined,
        };
      }
      switch (serverQuery?.kind) {
        case serverQueryKinds.traceDiagnostics:
          return traceDiagnostics;
        case serverQueryKinds.processDiagnostics:
          return processDiagnostics;
        case serverQueryKinds.processResourceHistory:
          return processResourceHistory;
        default:
          return query;
      }
    },
  };
});

vi.mock("../../state/server", async () => {
  const actual = await vi.importActual<typeof import("../../state/server")>("../../state/server");
  const { Atom } = await import("effect/unstable/reactivity");
  const { DEFAULT_RESOLVED_KEYBINDINGS } = await import("@t3tools/shared/keybindings");
  const { DEFAULT_SERVER_SETTINGS: defaultServerSettings } = await import("@t3tools/contracts");
  const configAtom = Atom.make<ServerConfig | null>(null);
  serverConfigHarness.configAtom = configAtom;

  return {
    ...actual,
    primaryServerConfigAtom: configAtom,
    primaryServerSettingsAtom: Atom.make(
      (get) => get(configAtom)?.settings ?? defaultServerSettings,
    ),
    primaryServerProvidersAtom: Atom.make((get) => get(configAtom)?.providers ?? []),
    primaryServerKeybindingsAtom: Atom.make(
      (get) => get(configAtom)?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS,
    ),
    primaryServerAvailableEditorsAtom: Atom.make((get) => get(configAtom)?.availableEditors ?? []),
    primaryServerKeybindingsConfigPathAtom: Atom.make(
      (get) => get(configAtom)?.keybindingsConfigPath ?? null,
    ),
    primaryServerObservabilityAtom: Atom.make((get) => get(configAtom)?.observability ?? null),
    serverEnvironment: {
      ...actual.serverEnvironment,
      processDiagnostics: () => ({ kind: serverQueryKinds.processDiagnostics }),
      processResourceHistory: ({
        input,
      }: {
        readonly input: Parameters<LocalApi["server"]["getProcessResourceHistory"]>[0];
      }) => ({
        kind: serverQueryKinds.processResourceHistory,
        input,
      }),
      refreshProviders: directAtomMocks.refreshProvidersAction,
      signalProcess: directAtomMocks.signalProcessAction,
      traceDiagnostics: () => ({ kind: serverQueryKinds.traceDiagnostics }),
      updateProvider: directAtomMocks.updateProviderAction,
    },
  };
});

vi.mock("../../state/auth", async () => {
  const actual = await vi.importActual<typeof import("../../state/auth")>("../../state/auth");

  return {
    ...actual,
    authEnvironment: {
      ...actual.authEnvironment,
      accessChanges: () => directAtomMocks.authAccessQuery,
    },
  };
});

vi.mock("../../state/shell", async () => {
  const actual = await vi.importActual<typeof import("../../state/shell")>("../../state/shell");

  return {
    ...actual,
    shellEnvironment: {
      ...actual.shellEnvironment,
      openInEditor: directAtomMocks.openInEditorAction,
    },
  };
});

vi.mock("../../state/environments", async () => {
  const React = await import("react");
  const { useAtomValue } = await import("@effect/atom-react");
  const EffectOption = await import("effect/Option");
  const { EnvironmentId: EnvironmentIdSchema } = await import("@t3tools/contracts");
  const { primaryServerConfigAtom: serverConfigAtom } = await import("../../state/server");
  const environmentId = EnvironmentIdSchema.make("environment-local");

  const usePrimaryEnvironment = () => {
    const serverConfig = useAtomValue(serverConfigAtom);
    return React.useMemo(
      () => ({
        environmentId,
        label: "Local environment",
        displayUrl: "http://localhost:3000",
        relayManaged: false,
        entry: {
          target: {
            _tag: "PrimaryConnectionTarget" as const,
            environmentId,
            label: "Local environment",
            httpBaseUrl: "http://localhost:3000",
            wsBaseUrl: "ws://localhost:3000",
          },
          profile: EffectOption.none(),
        },
        connection: {
          phase: "connected" as const,
          error: null,
          traceId: null,
        },
        serverConfig,
      }),
      [serverConfig],
    );
  };

  return {
    useEnvironments: () => {
      const primary = usePrimaryEnvironment();
      return {
        isReady: true,
        networkStatus: "online" as const,
        environments: [primary],
        presentationById: new Map([[environmentId, primary]]),
        shellStateById: new Map(),
      };
    },
    usePrimaryEnvironment: usePrimaryEnvironment,
    useRelayEnvironmentDiscovery: () => ({
      environments: new Map(),
      refreshing: false,
      offline: false,
      error: EffectOption.none(),
    }),
    useEnvironmentActions: () => ({
      connectPairing: mockConnectPairingEnvironment,
      connectSshEnvironment: mockConnectDesktopSshEnvironment,
      connectRelayEnvironment: mockConnectRelayEnvironment,
      removeEnvironment: mockRemoveEnvironment,
      retryEnvironment: mockRetryEnvironment,
      refreshRelayEnvironments: mockRefreshRelayEnvironments,
    }),
    useEnvironmentHttpBaseUrl: () => "http://localhost:3000",
  };
});

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-access-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function createOutdatedProvider(
  driver: string,
  updateCommand = "npm install -g openai/codex@latest",
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-05-04T10:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      message: "Update available.",
      checkedAt: "2026-05-04T10:00:00.000Z",
      updateCommand,
      canUpdate: true,
    },
  };
}

function makeUtc(value: string) {
  return DateTime.makeUnsafe(value);
}

function createEmptyProcessResourceHistoryResult(): ServerProcessResourceHistoryResult {
  return {
    readAt: makeUtc("2036-04-07T00:00:00.000Z"),
    windowMs: 15 * 60_000,
    bucketMs: 60_000,
    sampleIntervalMs: 5_000,
    retainedSampleCount: 0,
    totalCpuSecondsApprox: 0,
    buckets: [],
    topProcesses: [],
    error: Option.none(),
  };
}

function makePairingLink(input: {
  readonly id: string;
  readonly credential: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}): AuthAccessSnapshot["pairingLinks"][number] {
  return {
    ...input,
    createdAt: makeUtc(input.createdAt),
    expiresAt: makeUtc(input.expiresAt),
  };
}

function makeClientSession(input: {
  readonly sessionId: string;
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly method: "browser-session-cookie";
  readonly client?: {
    readonly label?: string;
    readonly ipAddress?: string;
    readonly userAgent?: string;
    readonly deviceType?: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
    readonly os?: string;
    readonly browser?: string;
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastConnectedAt?: string | null;
  readonly connected: boolean;
  readonly current: boolean;
}): AuthAccessSnapshot["clientSessions"][number] {
  return {
    ...input,
    client: {
      deviceType: "unknown",
      ...input.client,
    },
    sessionId: AuthSessionId.make(input.sessionId),
    issuedAt: makeUtc(input.issuedAt),
    expiresAt: makeUtc(input.expiresAt),
    lastConnectedAt:
      input.lastConnectedAt === undefined || input.lastConnectedAt === null
        ? null
        : makeUtc(input.lastConnectedAt),
  };
}

const createDesktopBridgeStub = (overrides?: {
  readonly discoverSshHosts?: DesktopBridge["discoverSshHosts"];
  readonly serverExposureState?: Awaited<ReturnType<DesktopBridge["getServerExposureState"]>>;
  readonly advertisedEndpoints?: Awaited<ReturnType<DesktopBridge["getAdvertisedEndpoints"]>>;
  readonly setServerExposureMode?: DesktopBridge["setServerExposureMode"];
  readonly setUpdateChannel?: DesktopBridge["setUpdateChannel"];
}): DesktopBridge => {
  const idleUpdateState: DesktopUpdateState = {
    enabled: false,
    status: "idle",
    channel: "latest",
    currentVersion: "0.0.0-test",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };

  return {
    getAppBranding: vi.fn().mockReturnValue(null),
    getLocalEnvironmentBootstrap: () => ({
      label: "Local environment",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773",
      bootstrapToken: "desktop-bootstrap-token",
    }),
    getClientSettings: vi.fn().mockResolvedValue(null),
    setClientSettings: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentRegistry: vi.fn().mockResolvedValue([]),
    setSavedEnvironmentRegistry: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentSecret: vi.fn().mockResolvedValue(null),
    setSavedEnvironmentSecret: vi.fn().mockResolvedValue(true),
    removeSavedEnvironmentSecret: vi.fn().mockResolvedValue(undefined),
    discoverSshHosts: overrides?.discoverSshHosts ?? vi.fn().mockResolvedValue([]),
    ensureSshEnvironment: vi.fn().mockImplementation(async (target) => ({
      target,
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
      pairingToken: "ssh-pairing-token",
    })),
    disconnectSshEnvironment: vi.fn().mockResolvedValue(undefined),
    fetchSshEnvironmentDescriptor: vi.fn().mockResolvedValue({
      environmentId: "environment-ssh",
      label: "SSH environment",
      platform: {
        os: "linux",
        arch: "x64",
      },
      serverVersion: "0.0.0-test",
      capabilities: {
        repositoryIdentity: true,
      },
    }),
    bootstrapSshBearerSession: vi.fn().mockResolvedValue({
      access_token: "ssh-bearer-token",
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      token_type: "Bearer",
      expires_in: 3_600,
      scope: "orchestration:read orchestration:operate terminal:operate review:write relay:read",
    }),
    fetchSshSessionState: vi.fn().mockResolvedValue({
      authenticated: true,
      auth: {
        policy: "remote-reachable",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["browser-session-cookie", "bearer-access-token"],
        sessionCookieName: "t3_session",
      },
      scopes: ["orchestration:read", "access:write"],
      sessionMethod: "bearer-access-token",
      expiresAt: "2026-05-01T12:00:00.000Z",
    }),
    issueSshWebSocketTicket: vi.fn().mockResolvedValue({
      ticket: "ssh-ws-ticket",
      expiresAt: "2026-05-01T12:05:00.000Z",
    }),
    onSshPasswordPrompt: vi.fn(() => () => {}),
    resolveSshPasswordPrompt: vi.fn().mockResolvedValue(undefined),
    getServerExposureState: vi.fn().mockResolvedValue(
      overrides?.serverExposureState ?? {
        mode: "local-only",
        endpointUrl: null,
        advertisedHost: null,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
    ),
    setServerExposureMode:
      overrides?.setServerExposureMode ??
      vi.fn().mockImplementation(async (mode) => ({
        mode,
        endpointUrl: mode === "network-accessible" ? "http://192.168.1.44:3773" : null,
        advertisedHost: mode === "network-accessible" ? "192.168.1.44" : null,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      })),
    setTailscaleServeEnabled: vi.fn().mockImplementation(async (input) => ({
      mode: overrides?.serverExposureState?.mode ?? "network-accessible",
      endpointUrl: overrides?.serverExposureState?.endpointUrl ?? "http://192.168.1.44:3773",
      advertisedHost: overrides?.serverExposureState?.advertisedHost ?? "192.168.1.44",
      tailscaleServeEnabled: input.enabled,
      tailscaleServePort: input.port ?? 443,
    })),
    getAdvertisedEndpoints: vi.fn().mockResolvedValue(overrides?.advertisedEndpoints ?? []),
    pickFolder: vi.fn().mockResolvedValue(null),
    confirm: vi.fn().mockResolvedValue(false),
    setTheme: vi.fn().mockResolvedValue(undefined),
    showContextMenu: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(true),
    createCloudAuthRequest: vi.fn().mockResolvedValue("t3code-dev://auth/callback?t3_state=test"),
    getCloudAuthToken: vi.fn().mockResolvedValue(null),
    setCloudAuthToken: vi.fn().mockResolvedValue(true),
    clearCloudAuthToken: vi.fn().mockResolvedValue(undefined),
    fetchCloudAuth: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {},
      body: "",
    }),
    onCloudAuthCallback: () => () => {},
    onMenuAction: () => () => {},
    getUpdateState: vi.fn().mockResolvedValue(idleUpdateState),
    setUpdateChannel:
      overrides?.setUpdateChannel ??
      vi.fn().mockImplementation(async (channel: DesktopUpdateChannel) => ({
        ...idleUpdateState,
        channel,
      })),
    checkForUpdate: vi.fn().mockResolvedValue({ checked: false, state: idleUpdateState }),
    downloadUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    installUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    onUpdateState: () => () => {},
  };
};

describe("GeneralSettingsPanel observability", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(async () => {
    resetServerConfigSnapshot();
    await __resetLocalApiForTests();
    localStorage.clear();
    useUiStateStore.setState({ defaultAdvertisedEndpointKey: null });
    authAccessHarness.reset();
    mockConnectDesktopSshEnvironment.mockReset();
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "desktopBridge");
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    resetServerConfigSnapshot();
    await __resetLocalApiForTests();
    authAccessHarness.reset();
  });

  it("hides owner pairing tools in browser-served loopback builds without remote exposure", async () => {
    Reflect.deleteProperty(window, "desktopBridge");
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions: [
        makeClientSession({
          sessionId: "session-owner",
          subject: "browser-owner",
          scopes: ["orchestration:read", "access:write"],
          method: "browser-session-cookie",
          client: {
            label: "Chrome on Mac",
            deviceType: "desktop",
            os: "macOS",
            browser: "Chrome",
            ipAddress: "127.0.0.1",
          },
          issuedAt: "2036-04-07T00:00:00.000Z",
          expiresAt: "2036-05-07T00:00:00.000Z",
          connected: true,
          current: true,
        }),
      ],
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            auth: createBaseServerConfig().auth,
            scopes: ["orchestration:read", "access:write"],
            sessionMethod: "browser-session-cookie",
            expiresAt: "2036-05-07T00:00:00.000Z",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unhandled fetch GET ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByRole("heading", { name: "This environment", exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByLabelText("Enable network access")).toBeDisabled();
    await expect
      .element(
        page.getByText(
          "This backend is only reachable on this machine. Restart it with a non-loopback host to enable remote pairing.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText("Authorized clients")).not.toBeInTheDocument();
    await expect.element(page.getByText("Chrome on Mac")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Remote environments", exact: true }))
      .toBeInTheDocument();
  });

  it("hides advertised endpoint rows when desktop network access is disabled", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "local-only",
        endpointUrl: null,
        advertisedHost: null,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
      advertisedEndpoints: [
        {
          id: "loopback",
          label: "This machine",
          provider: {
            id: "desktop-core",
            label: "Desktop",
            kind: "manual",
            isAddon: false,
          },
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          reachability: "loopback",
          compatibility: {
            hostedHttpsApp: "mixed-content-blocked",
            desktopApp: "compatible",
          },
          source: "desktop-core",
          status: "available",
          isDefault: true,
        },
        {
          id: "tailscale-ip",
          label: "Tailscale IP",
          provider: {
            id: "tailscale",
            label: "Tailscale",
            kind: "private-network",
            isAddon: true,
          },
          httpBaseUrl: "http://100.105.39.17:3773/",
          wsBaseUrl: "ws://100.105.39.17:3773/",
          reachability: "private-network",
          compatibility: {
            hostedHttpsApp: "mixed-content-blocked",
            desktopApp: "compatible",
          },
          source: "desktop-addon",
          status: "available",
        },
      ],
    });
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions: [],
    });
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Limited to this machine.")).toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "This machine", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Tailscale IP", exact: true }))
      .not.toBeInTheDocument();
  });

  it("collapses advertised endpoints behind the network access summary", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        endpointUrl: "http://192.168.86.39:3773",
        advertisedHost: "192.168.86.39",
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
      advertisedEndpoints: [
        {
          id: "desktop-loopback:3773",
          label: "This machine",
          provider: {
            id: "desktop-core",
            label: "Desktop",
            kind: "manual",
            isAddon: false,
          },
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          reachability: "loopback",
          compatibility: {
            hostedHttpsApp: "mixed-content-blocked",
            desktopApp: "compatible",
          },
          source: "desktop-core",
          status: "available",
        },
        {
          id: "desktop-lan:http://192.168.86.39:3773",
          label: "Local network",
          provider: {
            id: "desktop-core",
            label: "Desktop",
            kind: "manual",
            isAddon: false,
          },
          httpBaseUrl: "http://192.168.86.39:3773/",
          wsBaseUrl: "ws://192.168.86.39:3773/",
          reachability: "lan",
          compatibility: {
            hostedHttpsApp: "mixed-content-blocked",
            desktopApp: "compatible",
          },
          source: "desktop-core",
          status: "available",
          isDefault: true,
        },
        {
          id: "tailscale-ip:http://100.105.39.17:3773",
          label: "Tailscale IP",
          provider: {
            id: "tailscale",
            label: "Tailscale",
            kind: "private-network",
            isAddon: true,
          },
          httpBaseUrl: "http://100.105.39.17:3773/",
          wsBaseUrl: "ws://100.105.39.17:3773/",
          reachability: "private-network",
          compatibility: {
            hostedHttpsApp: "mixed-content-blocked",
            desktopApp: "compatible",
          },
          source: "desktop-addon",
          status: "available",
        },
      ],
    });
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions: [],
    });
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("http://192.168.86.39:3773/")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "+2" })).toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Local network", exact: true }))
      .not.toBeInTheDocument();

    await page.getByRole("button", { name: "+2" }).click();

    await expect
      .element(page.getByRole("heading", { name: "Local network", exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByText("Default", { exact: true })).toBeInTheDocument();
    await page.getByRole("button", { name: "Set as default" }).first().click();
    await expect.element(page.getByText("http://127.0.0.1:3773/").first()).toBeInTheDocument();
  });

  it("shows diagnostics inside About with a diagnostics link", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Diagnostics", exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByRole("link", { name: "View diagnostics" })).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. Exporting OTEL traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
  });

  it("creates and shows a pairing link when network access is enabled", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        endpointUrl: "http://192.168.1.44:3773",
        advertisedHost: "192.168.1.44",
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
    });
    let pairingLinks: Array<AuthAccessSnapshot["pairingLinks"][number]> = [];
    let clientSessions: Array<AuthAccessSnapshot["clientSessions"][number]> = [
      makeClientSession({
        sessionId: "session-owner",
        subject: "desktop-bootstrap",
        scopes: ["orchestration:read", "access:write"],
        method: "browser-session-cookie",
        client: {
          label: "This Mac",
          deviceType: "desktop",
          os: "macOS",
          browser: "Electron",
          ipAddress: "127.0.0.1",
        },
        issuedAt: "2036-04-07T00:00:00.000Z",
        expiresAt: "2036-05-07T00:00:00.000Z",
        connected: true,
        current: true,
      }),
    ];
    authAccessHarness.setSnapshot({
      pairingLinks,
      clientSessions,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/auth/pairing-token") && method === "POST") {
          pairingLinks = [
            makePairingLink({
              id: "pairing-link-1",
              credential: "pairing-token",
              scopes: ["orchestration:read"],
              subject: "one-time-token",
              label: "Julius iPhone",
              createdAt: "2036-04-07T00:00:00.000Z",
              expiresAt: "2036-04-10T00:05:00.000Z",
            }),
          ];
          clientSessions = [
            ...clientSessions,
            makeClientSession({
              sessionId: "session-client",
              subject: "one-time-token",
              scopes: ["orchestration:read"],
              method: "browser-session-cookie",
              client: {
                label: "Julius iPhone",
                deviceType: "mobile",
                os: "iOS",
                browser: "Safari",
                ipAddress: "192.168.1.88",
              },
              issuedAt: "2036-04-07T00:01:00.000Z",
              expiresAt: "2036-05-07T00:01:00.000Z",
              connected: false,
              current: false,
            }),
          ];
          authAccessHarness.setSnapshot({
            pairingLinks,
            clientSessions,
          });
          return new Response(
            JSON.stringify({
              id: "pairing-link-1",
              credential: "pairing-token",
              label: "Julius iPhone",
              expiresAt: "2036-04-10T00:05:00.000Z",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        throw new Error(`Unhandled fetch ${method} ${url}`);
      }),
    );

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Authorized clients")).toBeInTheDocument();
    await expect.element(page.getByText("Revoke others")).toBeInTheDocument();
    await expect.element(page.getByText("This Mac")).toBeInTheDocument();
    await page.getByRole("button", { name: "Create link", exact: true }).click();
    await expect.element(page.getByText("Create pairing link")).toBeInTheDocument();
    await expect.element(page.getByRole("checkbox", { name: /View environment/ })).toBeChecked();
    await expect.element(page.getByRole("checkbox", { name: /Operate tasks/ })).toBeChecked();
    await page.getByRole("button", { name: "Read only", exact: true }).click();
    await expect.element(page.getByRole("checkbox", { name: /View environment/ })).toBeChecked();
    await expect.element(page.getByRole("checkbox", { name: /Operate tasks/ })).not.toBeChecked();
    await page.getByRole("button", { name: "Create link", exact: true }).click();
    authAccessHarness.emitPairingLinkUpserted(pairingLinks[0]!);
    await expect
      .element(page.getByRole("button", { name: "Pairing link scopes: show 1 scope" }))
      .toBeInTheDocument();
    authAccessHarness.emitClientUpserted(clientSessions[1]!);
    await expect
      .element(page.getByText("Mobile · iOS · Safari · 192.168.1.88"))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Client scopes: show 1 scope" }).click();
    await expect.element(page.getByText("orchestration:read", { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: /^Copy pairing URL for:/ }))
      .toBeInTheDocument();
    await expect.element(page.getByText("Revoke others")).toBeInTheDocument();
  });

  it("revokes all other paired clients from settings", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        endpointUrl: "http://192.168.1.44:3773",
        advertisedHost: "192.168.1.44",
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
    });
    let clientSessions: Array<AuthAccessSnapshot["clientSessions"][number]> = [
      makeClientSession({
        sessionId: "session-owner",
        subject: "desktop-bootstrap",
        scopes: ["orchestration:read", "access:write"],
        method: "browser-session-cookie",
        client: {
          label: "This Mac",
          deviceType: "desktop",
          os: "macOS",
          browser: "Electron",
        },
        issuedAt: "2036-04-05T00:00:00.000Z",
        expiresAt: "2036-05-05T00:00:00.000Z",
        connected: true,
        current: true,
      }),
      makeClientSession({
        sessionId: "session-client",
        subject: "one-time-token",
        scopes: ["orchestration:read"],
        method: "browser-session-cookie",
        client: {
          label: "Julius iPhone",
          deviceType: "mobile",
          os: "iOS",
          browser: "Safari",
          ipAddress: "192.168.1.88",
        },
        issuedAt: "2036-04-05T00:01:00.000Z",
        expiresAt: "2036-05-05T00:01:00.000Z",
        connected: false,
        current: false,
      }),
    ];
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions,
    });

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/auth/clients/revoke-others") && method === "POST") {
        clientSessions = clientSessions.filter((session) => session.current);
        authAccessHarness.setSnapshot({
          pairingLinks: [],
          clientSessions,
        });
        authAccessHarness.emitClientRemoved("session-client");
        return new Response(JSON.stringify({ revokedCount: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Julius iPhone")).toBeInTheDocument();
    await page.getByRole("button", { name: "Revoke others", exact: true }).click();
    await expect.element(page.getByText("This Mac")).toBeInTheDocument();
    await expect.element(page.getByText("Julius iPhone")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows a disabled network access toggle with guidance in desktop builds", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    const networkAccessToggle = page.getByLabelText("Enable network access");
    await expect.element(networkAccessToggle).not.toBeDisabled();
    await networkAccessToggle.click();
    await expect.element(page.getByText("Enable network access?")).toBeInTheDocument();
    await expect
      .element(page.getByText("T3 Code will restart to expose this environment over the network."))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Restart and enable", exact: true }).click();
    await vi.waitFor(() => {
      expect(desktopBridge.setServerExposureMode).toHaveBeenCalledWith("network-accessible");
    });
    await expect.element(page.getByText("http://192.168.1.44:3773")).toBeInTheDocument();
  });

  it("adds desktop ssh environments from the add-environment dialog", async () => {
    const discoverSshHosts = vi.fn().mockResolvedValue([
      {
        alias: "devbox",
        hostname: "devbox.example.com",
        username: "julius",
        port: 22,
        source: "ssh-config" as const,
      },
    ]);
    window.desktopBridge = createDesktopBridgeStub({
      discoverSshHosts,
    });
    mockConnectDesktopSshEnvironment.mockResolvedValue({
      environmentId: EnvironmentId.make("environment-devbox"),
      label: "Build box",
      wsBaseUrl: "ws://127.0.0.1:3774/",
      httpBaseUrl: "http://127.0.0.1:3774/",
      createdAt: "2036-04-07T00:00:00.000Z",
      lastConnectedAt: "2036-04-07T00:00:00.000Z",
      desktopSsh: {
        alias: "devbox.example.com",
        hostname: "devbox.example.com",
        username: "julius",
        port: 2222,
      },
    });

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Add environment", exact: true }).click();
    const addEnvironmentDialog = page.getByRole("dialog", { name: "Add Environment" });
    await expect
      .element(addEnvironmentDialog.getByRole("heading", { name: "Add Environment", exact: true }))
      .toBeInTheDocument();
    await addEnvironmentDialog.getByRole("button", { name: /^SSH\b/ }).click();
    await vi.waitFor(() => {
      expect(discoverSshHosts).toHaveBeenCalledTimes(1);
    });
    await expect
      .element(page.getByRole("heading", { name: "devbox", exact: true }))
      .toBeInTheDocument();

    await addEnvironmentDialog.getByLabelText("SSH host or alias").fill("devbox.example.com");
    await addEnvironmentDialog.getByLabelText("Username").fill("julius");
    await addEnvironmentDialog.getByLabelText("Port").fill("2222");
    await addEnvironmentDialog
      .getByRole("button", { name: "Add environment", exact: true })
      .first()
      .click();

    await vi.waitFor(() => {
      expect(mockConnectDesktopSshEnvironment).toHaveBeenCalledWith({
        target: {
          alias: "devbox.example.com",
          hostname: "devbox.example.com",
          username: "julius",
          port: 2222,
        },
        label: "",
      });
    });
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<LocalApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      shell: {
        openInEditor,
      },
      server: {
        getProcessDiagnostics: vi.fn().mockResolvedValue({
          serverPid: 1234,
          readAt: makeUtc("2036-04-07T00:00:00.000Z"),
          processCount: 0,
          totalRssBytes: 0,
          totalCpuPercent: 0,
          processes: [],
          error: Option.none(),
        }),
        getProcessResourceHistory: vi
          .fn()
          .mockResolvedValue(createEmptyProcessResourceHistoryResult()),
        getTraceDiagnostics: vi.fn().mockResolvedValue({
          traceFilePath: "/repo/project/.t3/traces.jsonl",
          scannedFilePaths: ["/repo/project/.t3/traces.jsonl"],
          readAt: makeUtc("2036-04-07T00:00:00.000Z"),
          recordCount: 0,
          parseErrorCount: 0,
          firstSpanAt: Option.none(),
          lastSpanAt: Option.none(),
          failureCount: 0,
          interruptionCount: 0,
          slowSpanThresholdMs: 5_000,
          slowSpanCount: 0,
          logLevelCounts: {},
          topSpansByCount: [],
          slowestSpans: [],
          commonFailures: [],
          latestFailures: [],
          latestWarningAndErrorLogs: [],
          partialFailure: Option.none(),
          error: Option.none(),
        }),
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <DiagnosticsSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByLabelText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });

  it("shows an OpenCode server URL field in provider settings", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("Toggle OpenCode details").click();

    // The unified provider-instance card renders field labels without a
    // driver-name prefix (the driver name is already shown in the card
    // header), so the labels read "Server URL" / "Server password"
    // rather than the old "OpenCode server URL" / "OpenCode server password".
    await expect.element(page.getByText("Server URL")).toBeInTheDocument();
    await expect.element(page.getByPlaceholder("http://127.0.0.1:4096")).toBeInTheDocument();
    await expect.element(page.getByText("Server password")).toBeInTheDocument();
    await expect.element(page.getByPlaceholder("Optional")).toBeInTheDocument();
  });

  it("runs one-click provider updates from the provider card", async () => {
    const updateProvider = vi.fn<LocalApi["server"]["updateProvider"]>().mockResolvedValue({
      providers: [createOutdatedProvider("codex")],
    });
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      server: {
        updateProvider,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [createOutdatedProvider("codex")],
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Update available — view details" }).click();
    await expect.element(page.getByRole("button", { name: "Update now" })).toBeInTheDocument();
    await page.getByRole("button", { name: "Update now" }).click();

    expect(updateProvider).toHaveBeenCalledWith({
      provider: ProviderDriverKind.make("codex"),
      instanceId: ProviderInstanceId.make("codex"),
    });
  });

  it("keeps long provider update commands inside the fixed-width popover", async () => {
    const longUpdateCommand =
      "npm install -g @anthropic-ai/claude-code@latest --registry=https://registry.npmjs.org --cache=/tmp/t3code-provider-update-cache";

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [createOutdatedProvider("codex", longUpdateCommand)],
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Update available — view details" }).click();
    await expect.element(page.getByText(longUpdateCommand)).toBeInTheDocument();

    await vi.waitFor(() => {
      const popup = document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
      const commandCode = Array.from(document.querySelectorAll<HTMLElement>("code")).find(
        (element) => element.textContent === longUpdateCommand,
      );
      const scrollViewport = commandCode?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );

      expect(popup).toBeTruthy();
      expect(commandCode).toBeTruthy();
      expect(scrollViewport).toBeTruthy();

      const popupRect = popup!.getBoundingClientRect();
      const viewportRect = scrollViewport!.getBoundingClientRect();

      expect(popupRect.width).toBeGreaterThan(300);
      expect(popupRect.width).toBeLessThanOrEqual(337);
      expect(viewportRect.right).toBeLessThanOrEqual(popupRect.right + 0.5);
      expect(scrollViewport!.scrollWidth).toBeGreaterThan(scrollViewport!.clientWidth);
    });
  });
});

describe("SourceControlSettingsPanel discovery states", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(async () => {
    resetAppAtomRegistryForTests();
    await __resetLocalApiForTests();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    await __resetLocalApiForTests();
    resetAppAtomRegistryForTests();
  });

  function setSourceControlDiscoveryStub(
    discoverSourceControl: () => Promise<SourceControlDiscoveryResult>,
  ) {
    window.nativeApi = {
      server: {
        discoverSourceControl,
      },
    } as LocalApi;
  }

  it("shows skeleton sections while the first source control scan is pending", async () => {
    setSourceControlDiscoveryStub(() => new Promise(() => {}));

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Version Control")).toBeInTheDocument();
    await expect.element(page.getByText("Source Control Providers")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Rescan server environment" }))
      .toBeDisabled();
    await expect.element(page.getByText("Nothing detected yet")).not.toBeInTheDocument();
  });

  it("uses the shared empty state when discovery completes without tools", async () => {
    setSourceControlDiscoveryStub(async () => ({
      versionControlSystems: [],
      sourceControlProviders: [],
    }));

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Nothing detected yet")).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Install Git on the server, add optional hosting integrations or credentials your workspace needs, then rescan.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Scan" })).toBeInTheDocument();
  });

  it("keeps discovered rows instead of showing the empty state", async () => {
    setSourceControlDiscoveryStub(async () => ({
      versionControlSystems: [
        {
          kind: "git",
          label: "Git",
          executable: "git",
          implemented: true,
          status: "available",
          version: Option.some("git version 2.50.0"),
          installHint: "Install Git.",
          detail: Option.none(),
        },
      ],
      sourceControlProviders: [],
    }));

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("switch", { name: "Git availability" })).toBeDisabled();
    await expect.element(page.getByText("Nothing detected yet")).not.toBeInTheDocument();
  });

  it("shows Git fetch interval settings inside the Git details dropdown", async () => {
    setSourceControlDiscoveryStub(async () => ({
      versionControlSystems: [
        {
          kind: "git",
          label: "Git",
          executable: "git",
          implemented: true,
          status: "available",
          version: Option.some("git version 2.50.0"),
          installHint: "Install Git.",
          detail: Option.none(),
        },
      ],
      sourceControlProviders: [],
    }));

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const toggle = page.getByRole("button", { name: "Toggle Git details" });
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();

    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(page.getByLabelText("Automatic Git fetch interval in seconds"))
      .toBeVisible();
    await expect
      .element(page.getByText("Automatic Git fetches run every 30 seconds"))
      .not.toBeInTheDocument();
  });

  it("does not rescan on remount while the discovery atom is fresh", async () => {
    let calls = 0;
    setSourceControlDiscoveryStub(async () => {
      calls += 1;
      return {
        versionControlSystems: [
          {
            kind: "git",
            label: "Git",
            executable: "git",
            implemented: true,
            status: "available",
            version: Option.some("git version 2.50.0"),
            installHint: "Install Git.",
            detail: Option.none(),
          },
        ],
        sourceControlProviders: [],
      };
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("switch", { name: "Git availability" })).toBeDisabled();
    expect(calls).toBe(1);

    const teardown = mounted.cleanup ?? mounted.unmount;
    await teardown?.call(mounted).catch(() => {});
    mounted = null;
    document.body.innerHTML = "";

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("switch", { name: "Git availability" })).toBeDisabled();
    expect(calls).toBe(1);
  });
});
