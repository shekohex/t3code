import { EDITORS, EditorId, type EnvironmentId } from "@t3tools/contracts";
import { useAtomSet } from "@effect/atom-react";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useCallback, useMemo } from "react";
import { shellEnvironment } from "./state/shell";

const LAST_EDITOR_KEY = "t3code:last-editor";

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((editor) => availableEditorIds.has(editor.id))?.id ?? null;
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor ?? null;
}

export function useOpenInPreferredEditor(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
) {
  const openInEditor = useAtomSet(shellEnvironment.openInEditor, { mode: "promise" });

  return useCallback(
    async (targetPath: string): Promise<EditorId> => {
      if (environmentId === null) {
        throw new Error("No environment is selected.");
      }
      const editor = resolveAndPersistPreferredEditor(availableEditors);
      if (!editor) {
        throw new Error("No available editors found.");
      }
      await openInEditor({
        environmentId,
        input: {
          cwd: targetPath,
          editor,
        },
      });
      return editor;
    },
    [availableEditors, environmentId, openInEditor],
  );
}
