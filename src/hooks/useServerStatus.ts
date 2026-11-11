import { useQuery } from '@tanstack/react-query';
import type { ServerStatus } from '../lib/protocol';

async function fetchServerStatus(): Promise<ServerStatus> {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error(`Status check failed (${res.status}).`);
  return res.json() as Promise<ServerStatus>;
}

/**
 * Is the API server running, and is it set up for OpenAI?
 *
 * TanStack Query caches the result and refetches it when the window regains
 * focus. So after you fix `.env` and restart the server, switching back to
 * the tab updates the header without a page reload.
 *
 * - `data`: `{ ready: true, model }` or `{ ready: false, problem }`
 * - `isError`: the server couldn't be reached at all (after TanStack's retries)
 */
export function useServerStatus() {
  return useQuery({
    queryKey: ['server-status'],
    queryFn: fetchServerStatus,
    staleTime: 30_000, // Config rarely changes, so don't refetch more than every 30s.
  });
}
