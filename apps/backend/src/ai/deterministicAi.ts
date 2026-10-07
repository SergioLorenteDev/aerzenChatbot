import { detectIntent, inferSerialAvailability, parseBooleanAnswer } from "../utils/intent.js";
import { normalizeText } from "../utils/format.js";
import { resolveRegionAlias } from "../utils/manual-region.js";
import type { ConversationalAI, DocumentGroundedAnswerInput, HumanizedReplyInput, TurnAnalysis } from "./types.js";

const MODEL_ALIASES: Array<{ pattern: RegExp; model: string }> = [
  { pattern: /\bdelta\s*hybrid\b/i, model: "Delta Hybrid" },
  { pattern: /\bdelta\s*blower\b/i, model: "Delta Blower" },
  { pattern: /\bgm\s*35\b/i, model: "GM 35" },
  { pattern: /\bvmx\s*160\b/i, model: "VMX 160" },
  { pattern: /\bvml\b/i, model: "VML" },
  { pattern: /\bpi1\.?5\s+awk\s+cl\s+fda\s+gjl\s+r\s+z\b/i, model: "PI1.5 AWK CL FDA GJL R Z" }
];

const GREETING_PATTERNS = [
  /\bhola\b/i,
  /\bbuenas\b/i,
  /\bbuenos dias\b/i,
  /\bbuenas tardes\b/i,
  /\bque tal\b/i,
  /\bqué tal\b/i
];

function extractModel(message: string) {
  for (const alias of MODEL_ALIASES) {
    if (alias.pattern.test(message)) {
      return alias.model;
    }
  }
  return null;
}

function extractSerialCandidate(message: string) {
  const match = message.match(/\b[A-Z]{0,5}\d[\dA-Z-]{4,}\b/i);
  return match?.[0] ?? null;
}

function extractRegionCandidate(message: string) {
  const normalized = normalizeText(message);
  const direct = resolveRegionAlias(normalized);
  if (direct) {
    return direct;
  }

  const chunks = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const chunk of chunks) {
    const region = resolveRegionAlias(chunk);
    if (region) {
      return region;
    }
  }

  const multiWordCandidates = [
    "castilla la mancha",
    "ciudad real",
    "santa cruz de tenerife",
    "las palmas",
    "pais vasco"
  ];

  for (const candidate of multiWordCandidates) {
    if (normalized.includes(candidate)) {
      const region = resolveRegionAlias(candidate);
      if (region) {
        return region;
      }
    }
  }

  return null;
}

/**
 * Recorta el contenido a un extracto legible sin partir una frase por la mitad.
 * Se usa como respuesta cuando no hay proveedor de IA configurado.
 */
function firstSentences(text: string, maxLength = 320) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  let result = "";
  for (const sentence of compact.split(/(?<=[.!?])\s+/)) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (result && candidate.length > maxLength) {
      break;
    }
    result = candidate;
    if (result.length >= maxLength) {
      break;
    }
  }

  return result || compact.slice(0, maxLength);
}

export class DeterministicAI implements ConversationalAI {
  isEnabled() {
    return false;
  }

  async analyzeTurn(message: string): Promise<TurnAnalysis> {
    return {
      intent: detectIntent(message),
      isGreeting: GREETING_PATTERNS.some((pattern) => pattern.test(message)),
      yesNo: parseBooleanAnswer(message) ?? inferSerialAvailability(message) ?? null,
      normalizedModel: extractModel(message),
      serialCandidate: extractSerialCandidate(message),
      regionCandidate: extractRegionCandidate(message)
    };
  }

  async humanizeReply(input: HumanizedReplyInput): Promise<string> {
    return input.baseReply;
  }

  async answerFromDocuments(input: DocumentGroundedAnswerInput): Promise<string> {
    const lead = input.documents[0];
    if (!lead) {
      return "No he encontrado información suficiente para responder con seguridad.";
    }

    return `${firstSentences(lead.content)} Fuente: ${lead.title}.`;
  }
}
