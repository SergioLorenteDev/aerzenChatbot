import type { Manual, Region, Worker } from "@prisma/client";
import type { ChatMessage, ConversationContext } from "@aerzen/shared";
import type { VectorSearchResult } from "../vector/types.js";

export interface ManualLookupResult {
  manual: Manual | null;
}

export interface RegionResolutionResult {
  region: Region | null;
  worker: Worker | null;
}

export interface AuthorizedAnswer {
  answer: string;
  documents: VectorSearchResult[];
  aiUsed?: boolean;
  needsHumanHandoff?: boolean;
  offersManual?: boolean;
}

export interface PersistedSession {
  id: string;
  currentState: string;
  context: ConversationContext;
  messages: ChatMessage[];
}
