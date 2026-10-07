import { randomInt } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { TelegramService } from "../services/telegramService.js";
import { resolveRegionAlias } from "../utils/manual-region.js";
import { summarizeConversation } from "../utils/format.js";
import type { ManualLookupResult, RegionResolutionResult } from "../types/chat.js";

const telegramService = new TelegramService();

/**
 * Referencia legible y única. Se añade un sufijo aleatorio porque dos incidencias
 * creadas en el mismo milisegundo chocarían con el índice único de `reference`.
 */
function createIncidentReference() {
  return `INC-${Date.now()}${randomInt(100, 1000)}`;
}

function getDefaultTelegramChatIds() {
  const chatIds = [
    env.TELEGRAM_DEFAULT_CHAT_ID,
    ...(env.TELEGRAM_DEFAULT_CHAT_IDS?.split(",") ?? [])
  ]
    .map((chatId) => chatId?.trim())
    .filter((chatId): chatId is string => Boolean(chatId));

  return Array.from(new Set(chatIds));
}

export async function checkSerialNumber(serialNumber: string) {
  const machine = await prisma.machine.findFirst({
    where: {
      OR: [{ serialNumber }, { fabricationCode: serialNumber }, { equipmentNumber: serialNumber }]
    },
    include: { customer: true, region: true, assignedWorker: true }
  });

  return {
    exists: Boolean(machine),
    machineRecord: machine
  };
}

export async function getMachineBySerial(serialNumber: string) {
  return prisma.machine.findFirst({
    where: {
      OR: [{ serialNumber }, { fabricationCode: serialNumber }, { equipmentNumber: serialNumber }]
    },
    // Sin technicalDataSheet a propósito: nadie lo consume y su JSON de operación
    // acababa guardado en el contexto de cada sesión, engordándolo sin motivo.
    include: { customer: true, region: true, assignedWorker: true }
  });
}

export async function getWarrantyStatus(serialNumber: string) {
  const machine = await getMachineBySerial(serialNumber);
  if (!machine?.warrantyEnd) {
    return { status: "unknown" as const, warrantyEndDate: null };
  }

  return {
    status: machine.warrantyEnd >= new Date() ? ("in_warranty" as const) : ("out_of_warranty" as const),
    warrantyEndDate: machine.warrantyEnd.toISOString()
  };
}

export async function getAssignedWorker(args: { serialNumber?: string; regionName?: string }) {
  if (args.serialNumber) {
    const machine = await getMachineBySerial(args.serialNumber);
    if (!machine) {
      return { worker: null };
    }

    return { worker: machine.assignedWorker };
  }

  if (args.regionName) {
    const resolvedRegionName = resolveRegionAlias(args.regionName) ?? args.regionName;
    const region = await prisma.region.findUnique({
      where: { name: resolvedRegionName },
      include: { workers: true }
    });
    return { worker: region?.workers[0] ?? null };
  }

  return { worker: null };
}

export async function getRegionByCustomerOrSerial(args: {
  serialNumber?: string;
  machineRecord?: { customerId?: string | null; regionId?: string | null } | null;
}): Promise<RegionResolutionResult> {
  if (args.serialNumber) {
    const machine = await prisma.machine.findFirst({
      where: {
        OR: [
          { serialNumber: args.serialNumber },
          { fabricationCode: args.serialNumber },
          { equipmentNumber: args.serialNumber }
        ]
      },
      include: { region: true, assignedWorker: true }
    });
    if (machine) {
      return { region: machine.region, worker: machine.assignedWorker };
    }
  }

  if (args.machineRecord?.regionId) {
    const region = await prisma.region.findUnique({
      where: { id: args.machineRecord.regionId },
      include: { workers: true }
    });
    return { region, worker: region?.workers[0] ?? null };
  }

  return { region: null, worker: null };
}

export async function createIncident(args: {
  sessionId: string;
  serialNumber?: string;
  locality?: string;
  model: string;
  region?: { name?: string | null } | null;
  assignedWorkerId?: string | null;
  issueSummary: string;
}) {
  const machine = args.serialNumber ? await getMachineBySerial(args.serialNumber) : null;
  const resolvedSerialNumber = args.serialNumber?.trim() || machine?.serialNumber || "(no aportado)";
  const resolvedLocality = args.locality?.trim() || machine?.customer?.city || "(no aportada)";

  const incident = await prisma.incident.create({
    data: {
      reference: createIncidentReference(),
      sessionId: args.sessionId,
      machineId: machine?.id,
      serialNumber: resolvedSerialNumber,
      locality: resolvedLocality,
      model: args.model,
      regionName: args.region?.name ?? machine?.region.name ?? null,
      assignedWorkerId: args.assignedWorkerId ?? machine?.assignedWorkerId ?? null,
      issueSummary: args.issueSummary,
      telegramStatus: "pending"
    }
  });

  return { incident };
}

export async function getManualForModel(args: { model?: string; serialNumber?: string }): Promise<ManualLookupResult> {
  let model = args.model;
  if (!model && args.serialNumber) {
    const machine = await getMachineBySerial(args.serialNumber);
    model = machine?.model;
  }

  if (!model) {
    return { manual: null };
  }

  const manual =
    (await prisma.manual.findUnique({ where: { model } })) ??
    (await prisma.manual.findFirst({
      where: {
        OR: [
          { model: { contains: model, mode: "insensitive" } },
          { title: { contains: model, mode: "insensitive" } }
        ]
      }
    }));
  return { manual };
}

export async function sendConversationEmail(args: {
  to: string;
  summary: string;
  transcript: string;
}) {
  return {
    status: "mock_sent",
    to: args.to,
    queuedAt: new Date().toISOString(),
    preview: {
      subject: "Derivación de postventa AERZEN Iberica",
      body: `${args.summary}\n\n${args.transcript}`
    }
  };
}

export async function sendTelegramIncidentNotification(args: {
  incidentId: string;
  workerId?: string | null;
  workerName?: string | null;
  model: string;
  serialNumber?: string;
  locality?: string;
  regionName?: string | null;
  summary: string;
}) {
  if (!args.workerId) {
    await prisma.incident.update({
      where: { id: args.incidentId },
      data: { telegramStatus: "missing_worker" }
    });
    return {
      delivered: false,
      status: "missing_worker"
    };
  }

  const worker = await prisma.worker.findUnique({
    where: { id: args.workerId }
  });

  const chatIds = Array.from(
    new Set([worker?.telegramChatId, ...getDefaultTelegramChatIds()].filter((chatId): chatId is string => Boolean(chatId)))
  );

  const text = [
    "Nueva incidencia de postventa AERZEN Iberica",
    `Responsable: ${args.workerName ?? worker?.name ?? "No asignado"}`,
    `Modelo: ${args.model}`,
    `Serie/Fabricación: ${args.serialNumber?.trim() || "(no aportado)"}`,
    `Localidad: ${args.locality?.trim() || "(no aportada)"}`,
    `Zona: ${args.regionName ?? "No indicada"}`,
    `Resumen: ${args.summary}`
  ].join("\n");

  if (chatIds.length === 0) {
    await prisma.incident.update({
      where: { id: args.incidentId },
      data: {
        telegramStatus: "missing_chat_id"
      }
    });

    return {
      delivered: false,
      status: "missing_chat_id"
    };
  }

  const telegramResults = await Promise.all(
    chatIds.map((chatId) =>
      telegramService.sendMessage({
        chatId,
        text
      })
    )
  );

  const successfulResults = telegramResults.filter((result) => result.delivered);
  const failedResults = telegramResults.filter((result) => !result.delivered);
  const telegramStatus = successfulResults.length > 0 ? "sent" : failedResults[0]?.status ?? "failed";
  const telegramMessageId = successfulResults.map((result) => result.messageId).filter(Boolean).join(",");

  await prisma.incident.update({
    where: { id: args.incidentId },
    data: {
      telegramStatus,
      telegramMessageId: telegramMessageId || null
    }
  });

  return {
    delivered: successfulResults.length > 0,
    status: telegramStatus,
    messageId: telegramMessageId || undefined,
    error: failedResults.length > 0 ? failedResults.map((result) => result.error).filter(Boolean).join(" | ") : undefined
  };
}

export async function generateHumanHandoffPayload(args: {
  sessionId: string;
  incidentId: string;
  summaryLines: string[];
}) {
  return {
    handoff: {
      sessionId: args.sessionId,
      incidentId: args.incidentId,
      createdAt: new Date().toISOString(),
      summary: summarizeConversation(args.summaryLines)
    }
  };
}
