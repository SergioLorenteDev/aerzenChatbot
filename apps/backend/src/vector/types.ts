export interface VectorSearchFilters {
  model?: string;
  language?: string;
}

export interface VectorDocument {
  id: string;
  title: string;
  content: string;
  model?: string | null;
  language: string;
  sourceUrl?: string | null;
}

export interface VectorSearchResult extends VectorDocument {
  score: number;
}

export interface VectorStore {
  ingest(documents: VectorDocument[]): Promise<void>;
  search(query: string, filters?: VectorSearchFilters): Promise<VectorSearchResult[]>;
}
