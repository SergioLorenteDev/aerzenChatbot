export type UserIntent = "incident" | "general_info" | "unknown";

export type WarrantyStatus = "in_warranty" | "out_of_warranty" | "unknown";

export type SenderRole = "assistant" | "user" | "system";

export interface MessageMeta {
  aiUsed: boolean;
  label: string;
  trace?: {
    analysisAiUsed: boolean;
    humanizationAiUsed: boolean;
    baseReply?: string;
    finalReply?: string;
    humanizationChanged?: boolean;
  };
}

export interface ChatMessage {
  id: string;
  role: SenderRole;
  content: string;
  createdAt: string;
  meta?: MessageMeta;
  citations?: Array<{
    title: string;
    url?: string;
    excerpt?: string;
  }>;
}

export interface ConversationContext {
  sessionId: string;
  currentState: string;
  language: string;
  promptUsage?: Record<string, number>;
  model?: string;
  modelOptional?: string;
  serialNumber?: string;
  machineLocation?: string;
  issueDescription?: string;
  serialValidationAttempts?: number;
  locationValidationAttempts?: number;
  serialExists?: boolean;
  machineRecord?: unknown;
  machine?: unknown;
  warranty?: {
    status: WarrantyStatus;
    warrantyEndDate?: string | null;
  };
  assignedWorker?: unknown;
  worker?: unknown;
  region?: unknown;
  regionName?: string;
  locationVerified?: boolean;
  manual?: unknown;
  incident?: unknown;
  intent?: UserIntent;
  userAccepts?: boolean;
  userAcceptsContinue?: boolean;
  userHasSerial?: boolean;
  conversationSummary?: string;
  lastUserMessage?: string;
  satisfactionRating?: number;
  conversationClosed?: boolean;
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
}

export interface ChatResponse {
  sessionId: string;
  state: string;
  reply: ChatMessage;
  context: ConversationContext;
}
