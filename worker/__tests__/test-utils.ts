/** @cloudflare/workers-types' `Response.json()` returns `Promise<unknown>` (stricter than DOM lib's `any`) -- this narrows it for test assertions. */
export async function readJson<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
