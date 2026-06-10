import { useEffect, useRef } from "react";

import { emitWelcome, setServerConfigSnapshot } from "../rpc/serverState";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { usePrimaryEnvironment } from "../state/environments";

export function ServerStateProjection() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const config = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.config({ environmentId, input: {} }),
  );
  const configProjection = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.configProjection({ environmentId, input: {} }),
  );
  const welcome = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.welcome({ environmentId, input: {} }),
  );
  const projectedConfigRef = useRef<unknown>(null);
  const projectedWelcomeRef = useRef<unknown>(null);

  useEffect(() => {
    const projected = configProjection.data ?? config.data;
    if (projected === null || projectedConfigRef.current === projected) {
      return;
    }
    projectedConfigRef.current = projected;
    setServerConfigSnapshot(projected);
  }, [config.data, configProjection.data]);

  useEffect(() => {
    if (welcome.data === null || projectedWelcomeRef.current === welcome.data) {
      return;
    }
    projectedWelcomeRef.current = welcome.data;
    emitWelcome(welcome.data);
  }, [welcome.data]);

  return null;
}
