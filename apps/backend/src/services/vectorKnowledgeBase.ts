import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { createVectorStore } from "../vector/providers.js";
import type { VectorStore } from "../vector/types.js";

export class VectorKnowledgeBase {
  private readonly vectorStore: VectorStore;
  private initialized = false;
  private lastRefreshAt = 0;
  private documentCount = -1;

  constructor(vectorStore: VectorStore = createVectorStore()) {
    this.vectorStore = vectorStore;
  }

  /**
   * Reindexa como máximo una vez por VECTOR_CACHE_TTL_MS y solo si el número de
   * documentos ha cambiado, para que una reimportación se refleje sin reiniciar
   * el backend sin castigar cada búsqueda con una consulta completa.
   */
  async ensureReady() {
    const now = Date.now();
    if (this.initialized && now - this.lastRefreshAt < env.VECTOR_CACHE_TTL_MS) {
      return;
    }

    const documentCount = await prisma.authorizedDocument.count();
    if (this.initialized && documentCount === this.documentCount) {
      this.lastRefreshAt = now;
      return;
    }

    const docs = await prisma.authorizedDocument.findMany();
    await this.vectorStore.ingest(
      docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        model: doc.model,
        language: doc.language,
        sourceUrl: doc.sourceUrl
      }))
    );
    this.initialized = true;
    this.documentCount = documentCount;
    this.lastRefreshAt = now;
  }

  async search(query: string, filters?: { model?: string; language?: string }) {
    await this.ensureReady();
    return this.vectorStore.search(query, filters);
  }
}
