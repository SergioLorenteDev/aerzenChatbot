import type { ChatMessage, ConversationContext } from "@aerzen/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createMessageId, nowIso } from "../utils/format.js";
import type { PersistedSession } from "../types/chat.js";

export async function createSession(initialState: string, context: ConversationContext): Promise<PersistedSession> {
  const session = await prisma.conversationSession.create({
    data: {
      id: context.sessionId,
      currentState: initialState,
      language: context.language,
      contextJson: context as unknown as Prisma.InputJsonValue
    },
    include: { messages: true }
  });

  return {
    id: session.id,
    currentState: session.currentState,
    context,
    messages: []
  };
}

export async function getSession(sessionId: string): Promise<PersistedSession | null> {
  const session = await prisma.conversationSession.findUnique({
    where: { id: sessionId },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });

  if (!session) {
    return null;
  }

  return {
    id: session.id,
    currentState: session.currentState,
    context: session.contextJson as unknown as ConversationContext,
    messages: session.messages.map<ChatMessage>((message) => ({
      id: message.id,
      role: message.role as ChatMessage["role"],
      content: message.content,
      citations: (message.citations as ChatMessage["citations"]) ?? undefined,
      createdAt: message.createdAt.toISOString()
    }))
  };
}

export async function saveSessionState(sessionId: string, currentState: string, context: ConversationContext) {
  await prisma.conversationSession.update({
    where: { id: sessionId },
    data: {
      currentState,
      contextJson: context as unknown as Prisma.InputJsonValue,
      language: context.language
    }
  });
}

export async function appendMessage(
  sessionId: string,
  message: Omit<ChatMessage, "id" | "createdAt"> & Partial<Pick<ChatMessage, "id" | "createdAt">>
) {
  const createdAt = message.createdAt ? new Date(message.createdAt) : new Date();
  await prisma.conversationMessage.create({
    data: {
      id: message.id ?? createMessageId(),
      sessionId,
      role: message.role,
      content: message.content,
      citations: message.citations,
      createdAt
    }
  });
}

export async function buildTranscript(sessionId: string) {
  const messages = await prisma.conversationMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" }
  });

  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n");
}

export function createAssistantMessage(content: string, citations?: ChatMessage["citations"]): ChatMessage {
  return {
    id: createMessageId(),
    role: "assistant",
    content,
    citations,
    createdAt: nowIso()
  } as ChatMessage;
}

export function createUserMessage(content: string): ChatMessage {
  return {
    id: createMessageId(),
    role: "user",
    content,
    createdAt: nowIso()
  } as ChatMessage;
}
