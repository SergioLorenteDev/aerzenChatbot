import { hashToken, normalizeText } from "../utils/format.js";
import type { VectorDocument, VectorSearchFilters, VectorSearchResult, VectorStore } from "./types.js";

interface IndexedDocument extends VectorDocument {
  weights: Map<string, number>;
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(hashToken);
}

function matchesModel(documentModel?: string | null, requestedModel?: string) {
  if (!requestedModel) {
    return true;
  }

  if (!documentModel) {
    return true;
  }

  const normalizedDocumentModel = normalizeText(documentModel);
  const normalizedRequestedModel = normalizeText(requestedModel);

  return (
    normalizedDocumentModel === normalizedRequestedModel ||
    normalizedDocumentModel.includes(normalizedRequestedModel) ||
    normalizedRequestedModel.includes(normalizedDocumentModel)
  );
}

function toWeights(tokens: string[]) {
  const weights = new Map<string, number>();
  for (const token of tokens) {
    weights.set(token, (weights.get(token) ?? 0) + 1);
  }
  return weights;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const value of a.values()) {
    normA += value * value;
  }

  for (const value of b.values()) {
    normB += value * value;
  }

  for (const [token, value] of a.entries()) {
    dot += value * (b.get(token) ?? 0);
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class MemoryVectorStore implements VectorStore {
  private documents: IndexedDocument[] = [];

  async ingest(documents: VectorDocument[]) {
    this.documents = documents.map((document) => ({
      ...document,
      weights: toWeights(tokenize(`${document.title} ${document.content}`))
    }));
  }

  async search(query: string, filters: VectorSearchFilters = {}) {
    const queryWeights = toWeights(tokenize(query));
    return this.documents
      .filter((document) => {
        if (filters.language && document.language !== filters.language) {
          return false;
        }

        if (!matchesModel(document.model, filters.model)) {
          return false;
        }

        return true;
      })
      .map<VectorSearchResult>((document) => ({
        id: document.id,
        title: document.title,
        content: document.content,
        model: document.model,
        language: document.language,
        sourceUrl: document.sourceUrl,
        score: cosineSimilarity(queryWeights, document.weights)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }
}
