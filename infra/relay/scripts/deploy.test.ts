import { describe, expect, it } from "vite-plus/test";

import {
  hasDeployChanges,
  publicConfigFromOutput,
  reconcileRootEnvPublicConfig,
  reconcileRootEnvRelayUrl,
  serializeGithubOutput,
} from "./deploy.ts";

describe("hasDeployChanges", () => {
  it("detects resource, binding, and deletion changes", () => {
    expect(hasDeployChanges({ resources: {}, deletions: {} } as never)).toBe(false);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "create", bindings: [] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "noop", bindings: [{ action: "update" }] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {},
        deletions: {
          api: { action: "delete", bindings: [] },
        },
      } as never),
    ).toBe(true);
  });
});

describe("reconcileRootEnvRelayUrl", () => {
  it("adds the relay URL to an empty root env file", () => {
    expect(reconcileRootEnvRelayUrl("", "https://relay.example.test")).toBe(
      "T3CODE_RELAY_URL=https://relay.example.test\n",
    );
  });

  it("preserves unrelated root env entries while replacing a previous relay URL", () => {
    expect(
      reconcileRootEnvRelayUrl(
        "T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_example\nT3CODE_RELAY_URL=https://old.example.test\n",
        "https://relay.example.test",
      ),
    ).toBe(
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_example\nT3CODE_RELAY_URL=https://relay.example.test\n",
    );
  });
});

describe("reconcileRootEnvPublicConfig", () => {
  const config = {
    relayUrl: "https://relay.example.test",
    mobileTracingUrl: "https://api.axiom.co/v1/traces",
    mobileTracingDataset: "t3-code-mobile-traces-dev",
    mobileTracingToken: "xaat-public-ingest",
    clientTracingUrl: "https://api.axiom.co/v1/traces",
    clientTracingDataset: "t3-code-relay-client-traces-dev",
    clientTracingToken: "xaat-relay-client-ingest",
  } as const;

  it("adds the complete local client config", () => {
    expect(reconcileRootEnvPublicConfig("", config)).toBe(
      [
        "T3CODE_RELAY_URL=https://relay.example.test",
        "T3CODE_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "T3CODE_MOBILE_OTLP_TRACES_DATASET=t3-code-mobile-traces-dev",
        "T3CODE_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET=t3-code-relay-client-traces-dev",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });

  it("replaces stale values while preserving unrelated entries", () => {
    expect(
      reconcileRootEnvPublicConfig(
        [
          "T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_example",
          "T3CODE_RELAY_URL=https://old.example.test",
          "T3CODE_MOBILE_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "T3CODE_MOBILE_OTLP_TRACES_DATASET=old-dataset",
          "T3CODE_MOBILE_OTLP_TRACES_TOKEN=old-token",
          "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET=old-client-dataset",
          "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=old-client-token",
          "",
        ].join("\n"),
        config,
      ),
    ).toBe(
      [
        "T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_example",
        "T3CODE_RELAY_URL=https://relay.example.test",
        "T3CODE_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "T3CODE_MOBILE_OTLP_TRACES_DATASET=t3-code-mobile-traces-dev",
        "T3CODE_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET=t3-code-relay-client-traces-dev",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });
});

describe("serializeGithubOutput", () => {
  it("serializes relay deploy metadata for GitHub Actions outputs", () => {
    expect(
      serializeGithubOutput({
        changed: false,
        result: "noop",
        relay_url: "https://relay.example.test",
      }),
    ).toBe("changed=false\nresult=noop\nrelay_url=https://relay.example.test\n");
  });
});

describe("publicConfigFromOutput", () => {
  it("reads the complete public tracing config from persisted Alchemy output", () => {
    expect(
      publicConfigFromOutput({
        url: "https://relay.example.test",
        mobileTracingUrl: "https://api.axiom.co/v1/traces",
        mobileTracingDataset: "mobile",
        mobileTracingToken: "mobile-token",
        clientTracingUrl: "https://api.axiom.co/v1/traces",
        clientTracingDataset: "relay",
        clientTracingToken: "client-token",
      }),
    ).toEqual({
      relayUrl: "https://relay.example.test",
      mobileTracingUrl: "https://api.axiom.co/v1/traces",
      mobileTracingDataset: "mobile",
      mobileTracingToken: "mobile-token",
      clientTracingUrl: "https://api.axiom.co/v1/traces",
      clientTracingDataset: "relay",
      clientTracingToken: "client-token",
    });
  });

  it("rejects incomplete stack output", () => {
    expect(publicConfigFromOutput({ url: "https://relay.example.test" })).toBeNull();
  });
});
