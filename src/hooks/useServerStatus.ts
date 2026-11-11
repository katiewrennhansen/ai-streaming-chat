import { useEffect, useState } from 'react';
import type { ServerStatus } from '../lib/protocol';

/**
 * Is the API server running, and is it set up for OpenAI?
 *
 * Checks once on load, and again whenever the tab regains focus. So after you
 * fix `.env` and restart the server, switching back to the tab updates the
 * header without a page reload.
 *
 * - `data`: `{ ready: true, model }` or `{ ready: false, problem }`, or
 *   undefined before the first check finishes
 * - `isError`: the server couldn't be reached
 */
export function useServerStatus() {
  const [data, setData] = useState<ServerStatus>();
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    // Ignore a response that arrives after the component unmounted.
    let active = true;

    const check = async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) throw new Error(`Status check failed (${res.status}).`);
        const status = (await res.json()) as ServerStatus;
        if (!active) return;
        setData(status);
        setIsError(false);
      } catch {
        if (!active) return;
        setData(undefined);
        setIsError(true);
      }
    };

    void check();
    window.addEventListener('focus', check);
    return () => {
      active = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  return { data, isError };
}
