import { env } from "../config/env.js";
import { MemoryVectorStore } from "./memoryVectorStore.js";
import type { VectorStore } from "./types.js";

/**
 * `pgvector` y `qdrant` todavía no tienen implementación propia. En lugar de
 * ignorar la configuración en silencio, se avisa y se sigue con el store en
 * memoria para que el flujo conversacional no se rompa.
 */
class NotImplementedVectorStore extends MemoryVectorStore {
  constructor(public readonly providerName: "pgvector" | "qdrant") {
    super();
    console.warn(
      `[vector] VECTOR_PROVIDER=${providerName} todavía no está implementado: se usa el almacén en memoria. ` +
        "Configure VECTOR_PROVIDER=memory para evitar este aviso."
    );
  }
}

export function createVectorStore(): VectorStore {
  if (env.VECTOR_PROVIDER === "pgvector") {
    return new NotImplementedVectorStore("pgvector");
  }

  if (env.VECTOR_PROVIDER === "qdrant") {
    return new NotImplementedVectorStore("qdrant");
  }

  return new MemoryVectorStore();
}
