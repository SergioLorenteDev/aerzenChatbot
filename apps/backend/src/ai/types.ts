export interface TurnAnalysis {
  intent: "incident" | "general_info" | "unknown";
  isGreeting: boolean;
  yesNo: boolean | null;
  normalizedModel: string | null;
  serialCandidate: string | null;
  regionCandidate: string | null;
}

export interface HumanizedReplyInput {
  state: string;
  userMessage: string;
  baseReply: string;
  recentAssistantMessages?: string[];
  requireGreeting?: boolean;
}

export interface DocumentGroundedAnswerInput {
  question: string;
  model?: string;
  documents: Array<{
    title: string;
    content: string;
    sourceUrl?: string | null;
  }>;
}

export interface ConversationalAI {
  isEnabled(): boolean;
  analyzeTurn(message: string): Promise<TurnAnalysis>;
  humanizeReply(input: HumanizedReplyInput): Promise<string>;
  answerFromDocuments?(input: DocumentGroundedAnswerInput): Promise<string>;
}
