export const USER_AGENT = "get-found";
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Shared fetch wrapper: identifies the crawler and bounds every request with
 * a timeout so one slow/dead server can't hang a whole run.
 */
export function politeFetch(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
