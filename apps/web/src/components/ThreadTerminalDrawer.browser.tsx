import "../index.css";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const {
  terminalConstructorSpy,
  terminalDisposeSpy,
  fitAddonFitSpy,
  fitAddonLoadSpy,
  terminalControllerByEnvironmentId,
  useTerminalControllerMock,
  readLocalApiMock,
} = vi.hoisted(() => ({
  terminalConstructorSpy: vi.fn(),
  terminalDisposeSpy: vi.fn(),
  fitAddonFitSpy: vi.fn(),
  fitAddonLoadSpy: vi.fn(),
  terminalControllerByEnvironmentId: new Map<
    string,
    {
      session: {
        summary: null;
        buffer: string;
        status: "running";
        error: null;
        hasRunningSubprocess: false;
        updatedAt: null;
        version: number;
      };
      write: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      restart: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }
  >(),
  useTerminalControllerMock: vi.fn(),
  readLocalApiMock: vi.fn<
    () =>
      | {
          contextMenu: { show: ReturnType<typeof vi.fn> };
          shell: { openExternal: ReturnType<typeof vi.fn> };
        }
      | undefined
  >(() => ({
    contextMenu: { show: vi.fn(async () => null) },
    shell: { openExternal: vi.fn(async () => undefined) },
  })),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = fitAddonFitSpy;
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    cols = 80;
    rows = 24;
    options: { theme?: unknown } = {};
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        getLine: vi.fn(() => null),
      },
    };

    constructor(options: unknown) {
      terminalConstructorSpy(options);
    }

    loadAddon(addon: unknown) {
      fitAddonLoadSpy(addon);
    }

    open() {}

    write() {}

    clear() {}

    clearSelection() {}

    focus() {}

    refresh() {}

    scrollToBottom() {}

    hasSelection() {
      return false;
    }

    getSelection() {
      return "";
    }

    getSelectionPosition() {
      return null;
    }

    attachCustomKeyEventHandler() {
      return true;
    }

    registerLinkProvider() {
      return { dispose: vi.fn() };
    }

    onData() {
      return { dispose: vi.fn() };
    }

    onSelectionChange() {
      return { dispose: vi.fn() };
    }

    dispose() {
      terminalDisposeSpy();
    }
  },
}));

vi.mock("../state/terminalSessions", () => ({
  useTerminalController: (input: { environmentId: string }) => {
    useTerminalControllerMock(input);
    const controller = terminalControllerByEnvironmentId.get(input.environmentId);
    if (controller === undefined) {
      throw new Error(`Missing test terminal controller for ${input.environmentId}`);
    }
    return controller;
  },
}));

vi.mock("../state/server", () => ({
  useServerConfig: () => ({
    data: { availableEditors: [] },
    error: null,
    isLoading: false,
  }),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import { TerminalViewport } from "./ThreadTerminalDrawer";

const THREAD_ID = ThreadId.make("thread-terminal-browser");

function createTerminalController() {
  return {
    session: {
      summary: null,
      buffer: "",
      status: "running" as const,
      error: null,
      hasRunningSubprocess: false as const,
      updatedAt: null,
      version: 1,
    },
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

async function mountTerminalViewport(props: {
  threadRef: ReturnType<typeof scopeThreadRef>;
  drawerBackgroundColor?: string;
  drawerTextColor?: string;
  runtimeEnv?: Record<string, string>;
}) {
  const drawer = document.createElement("div");
  drawer.className = "thread-terminal-drawer";
  if (props.drawerBackgroundColor) {
    drawer.style.backgroundColor = props.drawerBackgroundColor;
  }
  if (props.drawerTextColor) {
    drawer.style.color = props.drawerTextColor;
  }

  const host = document.createElement("div");
  host.style.width = "800px";
  host.style.height = "400px";
  drawer.append(host);
  document.body.append(drawer);

  const screen = await render(
    <TerminalViewport
      threadRef={props.threadRef}
      threadId={THREAD_ID}
      terminalId="term-1"
      terminalLabel="Terminal"
      cwd="/repo/project"
      {...(props.runtimeEnv ? { runtimeEnv: props.runtimeEnv } : {})}
      onSessionExited={() => undefined}
      onAddTerminalContext={() => undefined}
      focusRequestId={0}
      autoFocus={false}
      resizeEpoch={0}
      drawerHeight={320}
      keybindings={[]}
    />,
    { container: host },
  );

  return {
    rerender: async (nextProps: {
      threadRef: ReturnType<typeof scopeThreadRef>;
      runtimeEnv?: Record<string, string>;
    }) => {
      await screen.rerender(
        <TerminalViewport
          threadRef={nextProps.threadRef}
          threadId={THREAD_ID}
          terminalId="term-1"
          terminalLabel="Terminal"
          cwd="/repo/project"
          {...(nextProps.runtimeEnv ? { runtimeEnv: nextProps.runtimeEnv } : {})}
          onSessionExited={() => undefined}
          onAddTerminalContext={() => undefined}
          focusRequestId={0}
          autoFocus={false}
          resizeEpoch={0}
          drawerHeight={320}
          keybindings={[]}
        />,
      );
    },
    cleanup: async () => {
      await screen.unmount();
      drawer.remove();
    },
  };
}

describe("TerminalViewport", () => {
  afterEach(() => {
    terminalControllerByEnvironmentId.clear();
    useTerminalControllerMock.mockClear();
    readLocalApiMock.mockClear();
    terminalConstructorSpy.mockClear();
    terminalDisposeSpy.mockClear();
    fitAddonFitSpy.mockClear();
    fitAddonLoadSpy.mockClear();
  });

  it("renders the terminal through the shared terminal controller without the desktop API", async () => {
    terminalControllerByEnvironmentId.set("environment-a", createTerminalController());
    readLocalApiMock.mockReturnValueOnce(undefined);

    const mounted = await mountTerminalViewport({
      threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
    });

    try {
      await vi.waitFor(() => {
        expect(useTerminalControllerMock).toHaveBeenCalledWith(
          expect.objectContaining({ environmentId: "environment-a" }),
        );
      });
      expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the terminal mounted when xterm fit runs before dimensions are ready", async () => {
    terminalControllerByEnvironmentId.set("environment-a", createTerminalController());
    fitAddonFitSpy.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'dimensions')");
    });

    const mounted = await mountTerminalViewport({
      threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
    });

    try {
      await vi.waitFor(() => {
        expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
      });
      expect(fitAddonFitSpy).toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("reattaches the terminal when the scoped thread reference changes", async () => {
    terminalControllerByEnvironmentId.set("environment-a", createTerminalController());
    terminalControllerByEnvironmentId.set("environment-b", createTerminalController());

    const mounted = await mountTerminalViewport({
      threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
    });

    try {
      await vi.waitFor(() => {
        expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
      });

      await mounted.rerender({
        threadRef: scopeThreadRef("environment-b" as never, THREAD_ID),
      });

      await vi.waitFor(() => {
        expect(useTerminalControllerMock).toHaveBeenCalledWith(
          expect.objectContaining({ environmentId: "environment-b" }),
        );
      });
      expect(terminalDisposeSpy).toHaveBeenCalledTimes(1);
      expect(terminalConstructorSpy).toHaveBeenCalledTimes(2);
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not reattach the terminal when the scoped thread reference values stay the same", async () => {
    terminalControllerByEnvironmentId.set("environment-a", createTerminalController());

    const mounted = await mountTerminalViewport({
      threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
    });

    try {
      await vi.waitFor(() => {
        expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
      });

      await mounted.rerender({
        threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
      });

      expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
      expect(terminalDisposeSpy).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not reattach when runtime env contents are unchanged but object identity changes", async () => {
    terminalControllerByEnvironmentId.set("environment-a", createTerminalController());

    const mounted = await mountTerminalViewport({
      threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
      runtimeEnv: { PATH: "/usr/bin", T3: "1" },
    });

    try {
      await vi.waitFor(() => {
        expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
      });

      await mounted.rerender({
        threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
        runtimeEnv: { T3: "1", PATH: "/usr/bin" },
      });

      expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
      expect(terminalDisposeSpy).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses the drawer surface colors for the terminal theme", async () => {
    terminalControllerByEnvironmentId.set("environment-a", createTerminalController());

    const mounted = await mountTerminalViewport({
      threadRef: scopeThreadRef("environment-a" as never, THREAD_ID),
      drawerBackgroundColor: "rgb(24, 28, 36)",
      drawerTextColor: "rgb(228, 232, 240)",
    });

    try {
      await vi.waitFor(() => {
        expect(terminalConstructorSpy).toHaveBeenCalledTimes(1);
      });

      expect(terminalConstructorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: expect.objectContaining({
            background: "rgb(24, 28, 36)",
            foreground: "rgb(228, 232, 240)",
          }),
        }),
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
