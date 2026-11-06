import { useEffect, useRef, useState } from "react";
import { errorText } from "./session";
import { useWorkspace } from "./workspace-context";

/** Serialize taps and keep errors on the initiating screen. Never replay a mutation. */
export function useMutation() {
  const { workspace } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(undefined);
    try { await action(); workspace.gateway.invalidate(); }
    catch (cause) {
      try { if (!(await workspace.reject(cause)) && mounted.current) setError(errorText(cause)); }
      catch (rejection) { if (mounted.current) setError(errorText(rejection)); }
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return { busy, error, run };
}
