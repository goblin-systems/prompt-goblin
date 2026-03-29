import { invoke } from "@tauri-apps/api/core";

export interface ProxyFetchResponse {
  status: number;
  body: string;
}

/**
 * Make an HTTP request through the Tauri Rust backend, bypassing browser CORS.
 * Use this for endpoints that don't return CORS headers (e.g. chatgpt.com).
 */
export async function proxyFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<ProxyFetchResponse> {
  return invoke<ProxyFetchResponse>("http_fetch", {
    request: {
      url,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body ?? null,
    },
  });
}
