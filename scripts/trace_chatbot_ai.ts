import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { postJson } from "./lib/chatApi.ts";

type TraceMeta = {
  aiUsed: boolean;
  label: string;
  trace?: {
    analysisAiUsed: boolean;
    humanizationAiUsed: boolean;
    baseReply?: string;
    finalReply?: string;
    humanizationChanged?: boolean;
  };
};

type ChatResponse = {
  sessionId: string;
  state: string;
  reply: {
    content: string;
    meta?: TraceMeta;
    citations?: Array<{ title: string; url?: string; excerpt?: string }>;
  };
};

type TraceTurn = {
  user?: string;
  state: string;
  assistant: string;
  aiLabel: string;
  analysisAiUsed?: boolean;
  humanizationAiUsed?: boolean;
  humanizationChanged?: boolean;
  baseReply?: string;
  citations?: Array<{ title: string; url?: string }>;
};

const apiBaseUrl = process.env.CHATBOT_TRACE_BASE_URL ?? "http://localhost:3001";
const outputDir = process.env.CHATBOT_TRACE_OUTPUT_DIR ?? path.join(process.cwd(), "reports", "chatbot");

const scenarios = [
  {
    name: "informacion-general-oferta-aerzen",
    turns: ["que vende AERZEN y cual es la oferta de la empresa"]
  },
  {
    name: "incidencia-con-trazado-ia",
    turns: [
      "hola",
      "tengo una incidencia",
      "delta hybrid",
      "11122",
      "madrid",
      "el equipo tiene alarma de temperatura",
      "no me ayuda eso",
      "si"
    ]
  }
];

async function startConversation() {
  return postJson<ChatResponse>(`${apiBaseUrl}/api/chat/start`);
}

async function sendMessage(sessionId: string, message: string) {
  return postJson<ChatResponse>(`${apiBaseUrl}/api/chat/message`, { sessionId, message });
}

function toTraceTurn(response: ChatResponse, user?: string): TraceTurn {
  return {
    user,
    state: response.state,
    assistant: response.reply.content,
    aiLabel: response.reply.meta?.label ?? "sin meta",
    analysisAiUsed: response.reply.meta?.trace?.analysisAiUsed,
    humanizationAiUsed: response.reply.meta?.trace?.humanizationAiUsed,
    humanizationChanged: response.reply.meta?.trace?.humanizationChanged,
    baseReply: response.reply.meta?.trace?.baseReply,
    citations: response.reply.citations?.map((citation) => ({ title: citation.title, url: citation.url }))
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const results = [];

  for (const scenario of scenarios) {
    const start = await startConversation();
    const transcript: TraceTurn[] = [toTraceTurn(start)];
    let last = start;

    for (const turn of scenario.turns) {
      last = await sendMessage(start.sessionId, turn);
      transcript.push(toTraceTurn(last, turn));
    }

    results.push({
      name: scenario.name,
      sessionId: start.sessionId,
      finalState: last.state,
      transcript
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    traceModeRequired: "Arranca el backend con CHATBOT_TRACE_AI=true para ver baseReply y cambios de humanización.",
    results
  };
  const reportPath = path.join(outputDir, `ai-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Informe: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
