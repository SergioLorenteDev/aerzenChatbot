/**
 * `crypto.randomUUID` solo existe en contextos seguros (https o localhost). En una
 * página servida por http falla, así que se usa un identificador alternativo.
 */
export function createMessageId() {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
