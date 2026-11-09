/**
 * Raw HTTP transport for the players. One place, no retries, no interpretation:
 * the caller gets the status, the headers we asked about, and the body text
 * exactly as the server sent it.
 */
export interface HttpResult {
  method: string;
  path: string;
  url: string;
  status: number;
  ok: boolean;
  ms: number;
  headers: Record<string, string>;
  bodyText: string;
  json: unknown | null;
}

export interface RequestSpec {
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
}

export async function send(spec: RequestSpec): Promise<HttpResult> {
  const url = `${process.env.SIM_BASE_URL ?? "http://127.0.0.1:3000"}${spec.path}`;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
    });
  } catch (err) {
    const ms = Date.now() - started;
    return {
      method: spec.method,
      path: spec.path,
      url,
      status: 0,
      ok: false,
      ms,
      headers: {},
      bodyText: `TRANSPORT_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      json: null,
    };
  }
  const bodyText = await res.text();
  let json: unknown | null = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = null;
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    method: spec.method,
    path: spec.path,
    url,
    status: res.status,
    ok: res.ok,
    ms: Date.now() - started,
    headers,
    bodyText,
    json,
  };
}

export function oneLine(result: HttpResult, max = 300): string {
  const body = result.bodyText.replace(/\s+/g, " ").trim();
  return body.length > max ? `${body.slice(0, max)}…` : body;
}
