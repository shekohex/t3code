import { useAtomSet } from "@effect/atom-react";
import type { AssetCreateUrlResult, AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";

const REFRESH_MARGIN_MS = 30_000;

interface CachedAssetUrl {
  readonly url: string;
  readonly expiresAt: number;
}

const assetUrlCache = new Map<string, CachedAssetUrl>();
const assetUrlRequests = new Map<string, Promise<CachedAssetUrl>>();

function assetCacheKey(environmentId: EnvironmentId, resource: AssetResource): string {
  return `${environmentId}:${JSON.stringify(resource)}`;
}

export async function resolveAssetUrl(input: {
  readonly environmentId: EnvironmentId;
  readonly httpBaseUrl: string;
  readonly resource: AssetResource;
  readonly createUrl: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly resource: AssetResource };
  }) => Promise<AssetCreateUrlResult>;
}): Promise<CachedAssetUrl> {
  const key = assetCacheKey(input.environmentId, input.resource);
  const cached = assetUrlCache.get(key);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached;
  }

  const inFlight = assetUrlRequests.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = input
    .createUrl({
      environmentId: input.environmentId,
      input: { resource: input.resource },
    })
    .then((result) => {
      const cachedResult = {
        url: new URL(result.relativeUrl, input.httpBaseUrl).toString(),
        expiresAt: result.expiresAt,
      };
      assetUrlCache.set(key, cachedResult);
      return cachedResult;
    })
    .finally(() => {
      assetUrlRequests.delete(key);
    });
  assetUrlRequests.set(key, request);
  return request;
}

export function useAssetUrl(environmentId: EnvironmentId, resource: AssetResource): string | null {
  const createUrl = useAtomSet(assetEnvironment.createUrl, { mode: "promise" });
  const preparedConnection = usePreparedConnection(environmentId);
  const resourceJson = JSON.stringify(resource);
  const stableResource = useMemo(() => JSON.parse(resourceJson) as AssetResource, [resourceJson]);
  const key = assetCacheKey(environmentId, stableResource);
  const [url, setUrl] = useState<string | null>(() => assetUrlCache.get(key)?.url ?? null);

  useEffect(() => {
    if (preparedConnection._tag === "None") {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const httpBaseUrl = preparedConnection.value.httpBaseUrl;

    const load = () => {
      void resolveAssetUrl({
        environmentId,
        httpBaseUrl,
        resource: stableResource,
        createUrl,
      })
        .then((result) => {
          if (cancelled) return;
          setUrl(result.url);
          refreshTimer = setTimeout(
            load,
            Math.max(0, result.expiresAt - Date.now() - REFRESH_MARGIN_MS),
          );
        })
        .catch(() => {
          if (!cancelled) setUrl(null);
        });
    };
    load();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [createUrl, environmentId, key, preparedConnection, stableResource]);

  return url;
}
