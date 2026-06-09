import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import {
  linkPrimaryEnvironmentToCloud,
  type CloudLinkTarget,
  unlinkPrimaryEnvironmentFromCloud,
} from "./linkEnvironment";

export const linkPrimaryEnvironment = connectionAtomRuntime
  .fn<{
    readonly target: CloudLinkTarget;
    readonly clerkToken: string;
  }>()(linkPrimaryEnvironmentToCloud)
  .pipe(Atom.withLabel("web:cloud:link-primary-environment"));

export const unlinkPrimaryEnvironment = connectionAtomRuntime
  .fn<{
    readonly target: CloudLinkTarget;
    readonly clerkToken: string | null;
  }>()(unlinkPrimaryEnvironmentFromCloud)
  .pipe(Atom.withLabel("web:cloud:unlink-primary-environment"));
