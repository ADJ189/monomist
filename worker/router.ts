export type RouteHandler<TContext> = (
  request: Request,
  params: Record<string, string>,
  context: TContext
) => Promise<Response>;

interface Route<TContext> {
  method: string;
  segments: string[];
  handler: RouteHandler<TContext>;
}

/**
 * Tiny path router (no dependency, no regex compilation step) -- this
 * app has a handful of routes, so a small linear matcher is easier to
 * read and test than pulling in a routing library. `:param` segments are
 * extracted positionally; `*` is not supported (not needed here).
 *
 * `TContext` (in practice, the Worker's `Env`) is passed through to
 * `match()`'s caller to hand to the resolved handler -- deliberately NOT
 * stored on the Router or in any module-level variable. Workers can
 * process multiple requests concurrently in one isolate, so per-request
 * data (like `env`) must flow through call arguments, never shared
 * mutable state.
 */
export class Router<TContext = unknown> {
  private routes: Route<TContext>[] = [];

  add(method: string, pattern: string, handler: RouteHandler<TContext>): this {
    this.routes.push({ method: method.toUpperCase(), segments: splitPath(pattern), handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler<TContext>): this {
    return this.add('GET', pattern, handler);
  }

  /** Returns the matched route's handler + extracted params, or null if nothing matches. */
  match(
    method: string,
    pathname: string
  ): { handler: RouteHandler<TContext>; params: Record<string, string> } | null {
    const pathSegments = splitPath(pathname);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const params = matchSegments(route.segments, pathSegments);
      if (params) return { handler: route.handler, params };
    }
    return null;
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    const a = actual[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return null;
    }
  }
  return params;
}
