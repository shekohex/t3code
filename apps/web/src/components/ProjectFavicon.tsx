import type { EnvironmentId } from "@t3tools/contracts";
import { FolderIcon } from "lucide-react";
import { useState } from "react";
import { useEnvironments } from "../state/environments";

const loadedProjectFaviconSrcs = new Set<string>();

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  className?: string;
}) {
  const { presentationById } = useEnvironments();
  const src = (() => {
    try {
      const baseUrl = presentationById.get(input.environmentId)
        ? (() => {
            const entry = presentationById.get(input.environmentId)!.entry;
            switch (entry.target._tag) {
              case "PrimaryConnectionTarget":
                return entry.target.httpBaseUrl;
              case "BearerConnectionTarget":
                return entry.profile._tag === "Some" &&
                  entry.profile.value._tag === "BearerConnectionProfile"
                  ? entry.profile.value.httpBaseUrl
                  : null;
              case "RelayConnectionTarget":
              case "SshConnectionTarget":
                return null;
            }
          })()
        : null;
      if (baseUrl === null) {
        return null;
      }
      const url = new URL("/api/project-favicon", baseUrl);
      url.searchParams.set("cwd", input.cwd);
      return url.toString();
    } catch {
      return null;
    }
  })();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    src && loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  if (!src) {
    return (
      <FolderIcon
        className={`size-3.5 shrink-0 text-muted-foreground/50 ${input.className ?? ""}`}
      />
    );
  }

  return (
    <>
      {status !== "loaded" ? (
        <FolderIcon
          className={`size-3.5 shrink-0 text-muted-foreground/50 ${input.className ?? ""}`}
        />
      ) : null}
      <img
        src={src}
        alt=""
        className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loaded" ? "" : "hidden"} ${input.className ?? ""}`}
        onLoad={() => {
          loadedProjectFaviconSrcs.add(src);
          setStatus("loaded");
        }}
        onError={() => setStatus("error")}
      />
    </>
  );
}
