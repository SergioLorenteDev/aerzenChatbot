/**
 * Cliente HTTP compartido por los scripts de conversación.
 *
 * El backend limita las peticiones por IP, así que los runners tienen que
 * esperar cuando reciben un 429 en lugar de darse por vencidos: una tanda de
 * conversaciones seguidas supera con facilidad el límite por defecto.
 */

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tiempo de espera indicado por el servidor, con respaldo si no viene cabecera. */
export function getRetryAfterMs(response: Response, body = "") {
  const header = response.headers.get("retry-after");

  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - Date.now());
    }
  }

  const match = /try again in ([\d.]+)s/i.exec(body);
  if (match?.[1]) {
    return Math.ceil(Number(match[1]) * 1000);
  }

  return 5_000;
}

export async function postJson<T>(
  url: string,
  body?: unknown,
  options: { maxAttempts?: number; timeoutMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError = `sin respuesta de ${url}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const text = await response.text();
    lastError = `${response.status} ${text.slice(0, 200)}`;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const waitMs = getRetryAfterMs(response, text);
      console.warn(`  ${response.status} en ${url}: reintentando en ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }

    break;
  }

  throw new Error(`Fallo al llamar a ${url}: ${lastError}`);
}
