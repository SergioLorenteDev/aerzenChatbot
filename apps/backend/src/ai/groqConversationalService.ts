import { env } from "../config/env.js";
import type { ConversationalAI, DocumentGroundedAnswerInput, HumanizedReplyInput, TurnAnalysis } from "./types.js";

const ANALYSIS_SCHEMA = {
  name: "turn_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: ["incident", "general_info", "unknown"]
      },
      isGreeting: { type: "boolean" },
      yesNo: {
        anyOf: [{ type: "boolean" }, { type: "null" }]
      },
      normalizedModel: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      serialCandidate: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      regionCandidate: {
        anyOf: [{ type: "string" }, { type: "null" }]
      }
    },
    required: ["intent", "isGreeting", "yesNo", "normalizedModel", "serialCandidate", "regionCandidate"]
  }
} as const;

export class GroqConversationalService implements ConversationalAI {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = env.GROQ_API_KEY ?? "";
    this.model = env.GROQ_MODEL;
    this.baseUrl = env.GROQ_BASE_URL;
  }

  isEnabled() {
    return Boolean(this.apiKey);
  }

  async analyzeTurn(message: string): Promise<TurnAnalysis> {
    const data = await this.createResponse({
      instructions:
        "Analiza el mensaje de un usuario para un chatbot de postventa industrial. No decidas hechos operativos. Solo clasifica intención, saludo y posibles entidades textuales. Si no estás seguro, devuelve unknown o null.",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: message }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          ...ANALYSIS_SCHEMA
        }
      }
    });

    const outputText = this.extractOutputText(data);
    return JSON.parse(outputText) as TurnAnalysis;
  }

  async humanizeReply(input: HumanizedReplyInput): Promise<string> {
    const data = await this.createResponse({
      instructions:
        [
          "Actua como redactor conversacional de un asistente de postventa de AERZEN Iberica.",
          "El motor determinista ya ha decidido la accion correcta. Tu unica mision es redactarla de forma humana.",
          "No estas obligado a copiar la frase base. Debes crear una formulacion nueva, natural y especifica para el contexto.",
          "No puedes cambiar hechos, datos, nombres, seriales, estados, garantías, zonas, responsables, URLs ni acciones ejecutadas.",
          "No inventes nada ni añadas información nueva.",
          "Habla como una persona de soporte técnico industrial: cercana, segura, clara y resolutiva.",
          "Usa frases cortas, pero evita sonar como plantilla.",
          "Haz una sola pregunta principal por turno si la respuesta la contiene.",
          "Evita tono burocrático, repetitivo o de formulario.",
          "No empieces siempre igual. No uses siempre 'Indíqueme por favor'.",
          "No repitas literalmente mensajes recientes del asistente.",
          "Puedes cambiar el orden, añadir una microfrase de contexto y usar vocabulario equivalente, pero mantén la misma accion conversacional.",
          "Si la frase base pide un dato, pide solo ese dato.",
          "Si la frase base ofrece una accion, no afirmes que ya se hizo.",
          "Si hay datos críticos en la base, consérvalos exactamente.",
          "Si la frase base menciona manual oficial, PDF oficial o fuentes, conserva esa trazabilidad visible.",
          "Si la frase base incluye una línea 'Fuentes:', mantenla al final con los mismos títulos.",
          "No uses expresiones internas como 'documentación autorizada', 'motor determinista', 'RAG', 'herramientas' o 'base estructurada' en la respuesta al usuario.",
          "Mantén el mensaje breve. Una o dos frases como máximo.",
          "Si el usuario ha saludado, empieza con un saludo breve como 'Hola.' o 'Buenas.'.",
          "Responde solo con el texto final."
        ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Estado: ${input.state}\n` +
                `Mensaje del usuario: ${input.userMessage}\n` +
                `Respuesta base: ${input.baseReply}\n` +
                `Debe incluir saludo: ${input.requireGreeting ? "sí" : "no"}\n` +
                `Últimos mensajes del asistente: ${(input.recentAssistantMessages ?? []).join(" | ") || "ninguno"}`
            }
          ]
        }
      ],
      text: {
        format: {
          type: "text"
        }
      }
    });

    const outputText = this.extractOutputText(data);
    return outputText.trim() || input.baseReply;
  }

  async answerFromDocuments(input: DocumentGroundedAnswerInput): Promise<string> {
    const sourcesBlock = input.documents
      .map(
        (document, index) =>
          `Fuente ${index + 1}: ${document.title}\nURL: ${document.sourceUrl ?? "sin URL"}\nContenido: ${document.content}`
      )
      .join("\n\n");

    const data = await this.createResponse({
      instructions: [
        "Responde en español como asistente de postventa de AERZEN Iberica.",
        "Tu respuesta debe basarse solo en las fuentes proporcionadas.",
        "No inventes datos ni uses conocimiento externo.",
        "Si la información no es suficiente, dilo con claridad.",
        "Redacta una respuesta natural, consultiva y útil, no un volcado de catálogo.",
        "Mantén las respuestas informativas breves: máximo 90 palabras salvo que el usuario pida detalle.",
        "No uses Markdown pesado: sin títulos con asteriscos, sin blockquotes y sin listas largas.",
        "Si la pregunta es amplia, da una orientación corta y termina con una única pregunta de enfoque.",
        "No empieces con 'Hola' o 'Buenas' salvo que la pregunta del usuario sea principalmente un saludo.",
        "Para incidencias, recomienda solo comprobaciones que aparezcan explícitamente en las fuentes.",
        "No añadas pasos técnicos plausibles por conocimiento general si no están en el contenido autorizado.",
        "Si las fuentes no contienen una solución directa, di que no hay base suficiente y recomienda derivación.",
        "Si hay varias fuentes, sintetiza lo común y menciona límites de la información disponible.",
        "No mezcles datos operativos como garantía, responsable o seriales si no vienen de herramientas estructuradas.",
        "No incluyas una línea de fuentes ni cites URLs dentro del texto; la interfaz puede gestionar fuentes aparte."
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Pregunta: ${input.question}\nModelo: ${input.model ?? "no indicado"}\n\nFuentes disponibles:\n${sourcesBlock}`
            }
          ]
        }
      ],
      text: {
        format: {
          type: "text"
        }
      }
    });

    const outputText = this.extractOutputText(data).trim();
    return outputText || "No he encontrado información suficiente para responder con seguridad.";
  }

  private async createResponse(body: Record<string, unknown>) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/responses`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: this.model,
            ...body
          }),
          signal: AbortSignal.timeout(env.GROQ_TIMEOUT_MS)
        });

        if (response.ok) {
          return (await response.json()) as {
            output_text?: string;
            output?: Array<{
              type: string;
              content?: Array<{
                type: string;
                text?: string;
              }>;
            }>;
          };
        }

        const errorText = await response.text();
        lastError = new Error(`Groq response error: ${response.status} ${errorText}`);

        // Un error de cliente (clave inválida, payload rechazado…) no se arregla
        // reintentando: solo tiene sentido reintentar 429 y errores de servidor.
        if (response.status < 500 && response.status !== 429) {
          throw lastError;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Groq response failed");
      }

      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    throw lastError ?? new Error("Groq response failed");
  }

  private extractOutputText(data: {
    output_text?: string;
    output?: Array<{
      type: string;
      content?: Array<{
        type: string;
        text?: string;
      }>;
    }>;
  }) {
    if (typeof data.output_text === "string" && data.output_text.trim()) {
      return data.output_text;
    }

    const messageNode = data.output?.find((item) => item.type === "message");
    const text = messageNode?.content?.find((item) => item.type === "output_text")?.text;
    if (text?.trim()) {
      return text;
    }

    throw new Error("Groq did not return output text");
  }
}
