/** 测试辅助：构造可断言调用序列的假 fetch。 */

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface FakeFetch {
  fetch: typeof fetch;
  calls: FetchCall[];
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 按调用顺序依次返回给定的响应；用完还被调用则直接抛错，便于发现多余请求。 */
export function createSequenceFetch(responses: Array<Response | (() => Response)>): FakeFetch {
  const calls: FetchCall[] = [];
  let index = 0;

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[index++];
    if (!next) throw new Error(`未预期的第 ${index} 次 fetch 调用: ${String(input)}`);
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;

  return { fetch: fakeFetch, calls };
}

/** 用 URL 匹配的方式响应，适合请求顺序不确定（并发）的场景。 */
export function createRoutedFetch(routes: Array<[RegExp, () => Response]>): FakeFetch {
  const calls: FetchCall[] = [];

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`没有匹配的路由: ${url}`);
    return route[1]();
  }) as typeof fetch;

  return { fetch: fakeFetch, calls };
}

/** 生成带 exp 的假 JWT（只有 payload 是真的，签名部分是占位符）。 */
export function fakeJwt(expiresInSeconds: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + expiresInSeconds };
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${encoded}.signature`;
}
