export class ProviderHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, detail?: string) {
    super(`HTTP ${status} from ${url}${detail ? `: ${detail}` : ""}`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.url = url;
  }
}

const MAX_RETRY_AFTER_S = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  const s = Number.isFinite(seconds) && seconds >= 0 ? seconds : 1;
  return Math.min(s, MAX_RETRY_AFTER_S) * 1000;
}

/**
 * fetch with retries: 429 waits Retry-After (default 1 s, max 60 s); 5xx and network errors back off
 * 0.5 s, 1 s, 2 s. Other non-2xx responses throw ProviderHttpError immediately.
 */
export async function fetchWithRetry(url: string, init: RequestInit, opts: { maxRetries?: number } = {}): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      const detail = await res.text().catch(() => "");
      throw new ProviderHttpError(res.status, url, detail.slice(0, 200));
    }
    await sleep(res.status === 429 ? retryAfterMs(res) : 500 * 2 ** attempt);
  }
}
