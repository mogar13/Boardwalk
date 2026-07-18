/**
 * The HTTP transport for the server-authoritative repos (BACKEND_PLAN.md). One reason this file
 * exists: to keep `firebase/*` OUT of the API layer entirely. The token this client sends is a
 * Firebase ID token, but this module never imports the SDK to get it — the token is INJECTED as
 * `getToken`, so `@boardwalk/no-firebase-imports` stays satisfied and the composition root is the
 * one place that knows both worlds. Swapping the data layer is meant to touch this directory and
 * `../index.ts`, nothing else.
 */

export interface ApiClientConfig {
  /** The referee's base URL, e.g. https://boardwalk-api.example over the tunnel. */
  readonly baseUrl: string;
  /** Resolve the current Firebase ID token, or `null` when signed out. Injected by the root. */
  readonly getToken: () => Promise<string | null>;
}

/**
 * A fetch with the bearer token attached and JSON defaults set. Throws on a network failure
 * (an unexpected condition, per the RepoResult doctrine); a non-2xx is returned for the caller
 * to interpret, because "404 means no profile" is a normal answer, not a crash.
 */
export async function apiFetch(
  cfg: ApiClientConfig,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await cfg.getToken();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (token !== null) headers.set('authorization', `Bearer ${token}`);

  return fetch(new URL(path, cfg.baseUrl).toString(), { ...init, headers });
}
