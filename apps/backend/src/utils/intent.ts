import type { UserIntent } from "@aerzen/shared";
import { normalizeText } from "./format.js";

const INCIDENT_KEYWORDS = [
  "incidencia",
  "averia",
  "falla",
  "fallo",
  "problema",
  "error",
  "alarma",
  "parada",
  "parado",
  "se para",
  "no arranca",
  "no funciona",
  "soporte tecnico",
  "soporte",
  "revisar una maquina",
  "reviseis una maquina",
  "ruido",
  "vibracion",
  "vibraciones",
  "temperatura",
  "se calienta",
  "calienta",
  "sobrepresion",
  "caudal bajo",
  "fuga",
  "pierde",
  "rendimiento",
  "variador",
  "no reinicia",
  "dispara proteccion"
];

const GENERAL_INFO_KEYWORDS = [
  "informacion",
  "manual",
  "mantenimiento",
  "documentacion",
  "oferta",
  "empresa",
  "venden",
  "vende",
  "productos",
  "producto",
  "servicios",
  "servicio",
  "soluciones",
  "solucion",
  "catalogo",
  "aerzen",
  "soplantes",
  "compresores",
  "turbosoplantes",
  "aplicaciones",
  "garantia",
  "placa",
  "modelo",
  "consulta",
  "como",
  "donde"
];

export function detectIntent(message: string): UserIntent {
  const normalized = normalizeText(message);

  if (INCIDENT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "incident";
  }

  if (GENERAL_INFO_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "general_info";
  }

  return "unknown";
}

export function parseBooleanAnswer(message: string): boolean | undefined {
  const normalized = normalizeText(message).replace(/[.,;:!?]/g, " ");
  if (
    [
      "si",
      "sí",
      "claro",
      "correcto",
      "vale",
      "de acuerdo",
      "ok",
      "adelante",
      "por supuesto",
      "me parece bien",
      "perfecto"
    ].some((word) => normalized === word || normalized.startsWith(`${word} `))
  ) {
    return true;
  }

  if (
    ["no", "negativo", "todavia no", "todavía no", "no gracias", "no hace falta", "ahora no"].some(
      (word) => normalized === word || normalized.startsWith(`${word} `)
    ) ||
    normalized.includes("prefiero que no")
  ) {
    return false;
  }

  return undefined;
}

export function inferSerialAvailability(message: string) {
  return parseBooleanAnswer(message);
}

export function parseRating(message: string): number | undefined {
  const normalized = normalizeText(message);
  const stars = (message.match(/⭐/g) ?? []).length;
  if (stars >= 1 && stars <= 5) {
    return stars;
  }

  const digitMatch = normalized.match(/\b([1-5])\b/);
  if (digitMatch) {
    return Number(digitMatch[1]);
  }

  const wordMap: Record<string, number> = {
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5
  };

  for (const [word, rating] of Object.entries(wordMap)) {
    if (normalized.includes(word)) {
      return rating;
    }
  }

  return undefined;
}
