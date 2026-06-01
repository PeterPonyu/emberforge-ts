/**
 * Minimal structural fetch transport. Hosted providers construct requests and
 * dispatch them through a `FetchLike`, which defaults to the global `fetch` but
 * can be injected in tests to avoid real network calls (EFPORT-2 requires
 * offline tests).
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<FetchResponse>;

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Adapts the global `fetch` to the structural `FetchLike` shape. */
export const globalFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    json: () => response.json(),
  };
};
