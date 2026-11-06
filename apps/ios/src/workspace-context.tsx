import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { User } from "@turtle/protocol";
import type { Api } from "./api";
import { Resource } from "./resource";
import { session } from "./runtime";
import { WorkspaceSession } from "./workspace-session";

const Context = createContext<{ workspace: WorkspaceSession; user: User } | null>(null);

export function WorkspaceProvider({ api, user, children }: { api: Api; user: User; children: ReactNode }) {
  const workspace = useMemo(() => new WorkspaceSession(api, session), [api]);
  const value = useMemo(() => ({ workspace, user }), [workspace, user]);
  useEffect(() => {
    workspace.start();
    const listener = AppState.addEventListener("change", state => { if (state === "active") workspace.resume(); });
    return () => { listener.remove(); void workspace.dispose(); };
  }, [workspace]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("WorkspaceProvider ausente.");
  return context;
}
export function useCall() {
  const { workspace } = useWorkspace();
  return useSyncExternalStore(workspace.voice.subscribe, workspace.voice.getSnapshot);
}
export function usePresence() {
  const { workspace } = useWorkspace();
  return useSyncExternalStore(workspace.gateway.subscribe, workspace.gateway.getSnapshot);
}
export function useDirectory() {
  const { workspace } = useWorkspace();
  return useSyncExternalStore(workspace.directory.subscribe, workspace.directory.getSnapshot);
}
export function useWorkspaceState() {
  const { workspace } = useWorkspace();
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
}
export function useRead<T>(initial: T, load: () => Promise<T>) {
  const { workspace } = useWorkspace();
  const { revision } = usePresence();
  const resource = useMemo(() => new Resource(initial, load, workspace.reject), [load, workspace]);
  useEffect(() => () => resource.dispose(), [resource]);
  useFocusEffect(useCallback(() => { void resource.refresh(); }, [resource, revision]));
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  return { ...state, refresh: resource.refresh };
}
