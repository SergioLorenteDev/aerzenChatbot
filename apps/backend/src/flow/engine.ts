import type { ChatResponse, ConversationContext } from "@aerzen/shared";
import { flowDefinition, type FlowState } from "./definition.js";
import {
  appendMessage,
  buildTranscript,
  createAssistantMessage,
  createSession,
  createUserMessage,
  getSession,
  saveSessionState
} from "../services/sessionRepository.js";
import { detectIntent, inferSerialAvailability, parseBooleanAnswer, parseRating } from "../utils/intent.js";
import {
  checkSerialNumber,
  createIncident,
  generateHumanHandoffPayload,
  getAssignedWorker,
  getManualForModel,
  getMachineBySerial,
  getRegionByCustomerOrSerial,
  getWarrantyStatus,
  sendTelegramIncidentNotification,
  sendConversationEmail
} from "../tools/operationalTools.js";
import { RagService } from "../services/ragService.js";
import { normalizeText, summarizeConversation } from "../utils/format.js";
import { randomUUID } from "node:crypto";
import { createConversationalAI } from "../ai/index.js";
import { DeterministicAI } from "../ai/deterministicAi.js";
import { resolveRegionAlias } from "../utils/manual-region.js";
import { env } from "../config/env.js";

interface EngineReply {
  state: FlowState;
  content: string;
  aiUsed: boolean;
  skipHumanization?: boolean;
  trace?: {
    analysisAiUsed: boolean;
  };
  citations?: ChatResponse["reply"]["citations"];
}

interface EngineConversationContext extends ConversationContext {
  promptUsage?: Record<string, number>;
  issueDescription?: string;
  serialValidationAttempts?: number;
  locationValidationAttempts?: number;
  satisfactionRating?: number;
  conversationClosed?: boolean;
  issueGuidance?: string;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class FlowEngine {
  private readonly ragService = new RagService();
  private readonly conversationalAI = createConversationalAI();
  private readonly deterministicAI = new DeterministicAI();
  private readonly promptVariants: Partial<Record<FlowState, string[]>> = {
    greeting: [
      "Soy el asistente de postventa de AERZEN Iberica. ¿Tiene una incidencia con su máquina o necesita información general?",
      "Bienvenido al servicio de postventa de AERZEN Iberica. ¿Se trata de una incidencia o de una consulta general?",
      "Estoy para ayudarle con postventa AERZEN Iberica. ¿Necesita resolver una incidencia o busca información general?"
    ],
    intent_detection_fallback: [
      "Para ayudarle mejor, necesito saber si se trata de una incidencia con su equipo o de una consulta informativa general.",
      "Necesito distinguir primero si hablamos de una incidencia o de una consulta general.",
      "Antes de seguir, indíqueme si necesita soporte por una incidencia o información general."
    ],
    collect_model: [
      "Indíqueme por favor el modelo de su equipo. Por ejemplo: GM 35.",
      "Necesito el modelo del equipo. Por ejemplo: GM 35.",
      "Para continuar, dígame el modelo de la máquina. Por ejemplo: GM 35."
    ],
    ask_serial_availability: [
      "¿Dispone del número de fabricación o número de serie? Suele encontrarse en la placa del equipo.",
      "¿Tiene a mano el número de fabricación o de serie? Normalmente aparece en la placa del equipo.",
      "Necesito saber si dispone del número de fabricación o serie. Suele venir en la placa."
    ],
    collect_serial: [
      "Indíqueme por favor el número de fabricación o serie.",
      "Facilíteme, por favor, el número de fabricación o serie.",
      "Cuando pueda, indíqueme el número de fabricación o de serie."
    ],
    collect_machine_location: [
      "Indíqueme por favor la ciudad o provincia donde está instalada la maquinaria.",
      "Necesito confirmar la ubicación. Dígame la ciudad o provincia donde está el equipo.",
      "Para contrastar los datos, indíqueme la ciudad o provincia de la instalación."
    ],
    area_contact_offer: [
      "¿Desea que se ponga en contacto con usted el responsable de área?",
      "¿Quiere que el responsable de zona contacte con usted?",
      "Si le parece, puedo hacer que el responsable de área se ponga en contacto con usted. ¿Quiere que lo gestione?"
    ],
    confirm_handoff: [
      "He localizado la zona y el responsable asignado. ¿Quiere que prepare la derivación de este caso?",
      "Ya tengo identificados la zona y el responsable. ¿Desea que deje preparada la derivación?",
      "He podido resolver el responsable asignado. ¿Quiere que derive el caso?"
    ],
    manual_offer: [
      "¿Desea que le facilitemos el manual de su equipo?",
      "¿Quiere que le envíe el manual correspondiente al equipo?",
      "Si lo desea, puedo facilitarle el manual del equipo. ¿Quiere que lo haga?"
    ],
    manual_resolution_check: [
      "Después de revisar el manual, ¿la incidencia ha quedado resuelta? Si no se ha resuelto, le paso con el responsable de zona.",
      "Cuando revise el manual, indíqueme si el problema ha quedado resuelto. Si sigue igual, lo derivo al responsable de zona.",
      "Tras consultar el manual, necesito confirmar una cosa: ¿la incidencia está resuelta? Si no, preparo la derivación al responsable de área."
    ],
    issue_resolution_check: [
      "¿Con estas comprobaciones se ha resuelto la incidencia?",
      "Después de revisar estos puntos, ¿el equipo queda funcionando correctamente?",
      "¿Le sirve esta primera revisión o seguimos con la derivación al responsable?"
    ],
    anything_else_offer: [
      "¿Necesita algo más sobre este equipo o sobre otra máquina?",
      "¿Puedo ayudarle en algo más antes de cerrar la conversación?",
      "¿Quiere que revisemos algo más antes de dar el caso por cerrado?"
    ],
    collect_rating: [
      "Antes de cerrar, ¿cómo valora la atención recibida? Puede indicarme de 1 a 5 estrellas.",
      "Para cerrar la conversación, ¿qué valoración nos da de 1 a 5 estrellas?",
      "Una última cosa. ¿Cómo valora la atención recibida de 1 a 5 estrellas?"
    ],
    closing: [
      "Gracias por su valoración. Doy por cerrada la conversación. Quedo a su disposición para futuras consultas.",
      "Gracias por la valoración. Cierro la conversación por aquí. Si más adelante lo necesita, aquí estaré.",
      "Muchas gracias. Dejo la conversación cerrada. Puede volver cuando necesite ayuda."
    ]
  };

  private normalizeModelName(model?: string | null) {
    if (!model?.trim()) {
      return model ?? null;
    }

    const compact = normalizeText(model).replace(/\s+/g, "");
    const gmMatch = compact.match(/^gm(\d{1,3})$/);
    if (gmMatch) {
      return `GM ${gmMatch[1]}`;
    }

    const vmxMatch = compact.match(/^vmx(\d{1,3})$/);
    if (vmxMatch) {
      return `VMX ${vmxMatch[1]}`;
    }

    return model;
  }

  private getManualPublicUrl(manualId: string) {
    const baseUrl = env.PUBLIC_API_BASE_URL?.trim() || `http://localhost:${env.PORT}`;
    return `${baseUrl}/api/manuals/${manualId}/file`;
  }

  async startConversation(): Promise<ChatResponse> {
    const sessionId = randomUUID();
    const context: EngineConversationContext = {
      sessionId,
      currentState: flowDefinition.initialState,
      language: "es",
      promptUsage: {},
      serialValidationAttempts: 0,
      locationValidationAttempts: 0,
      conversationSummary: ""
    };

    await createSession(flowDefinition.initialState, context);
    const reply = createAssistantMessage(this.getPrompt("greeting", context));
    await appendMessage(sessionId, reply);

    return {
      sessionId,
      state: flowDefinition.initialState,
      reply,
      context
    };
  }

  async handleMessage(sessionId: string, message: string): Promise<ChatResponse> {
    const session = await getSession(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    const userMessage = createUserMessage(message);
    await appendMessage(sessionId, userMessage);

    const context: EngineConversationContext = {
      ...session.context,
      lastUserMessage: message
    };

    const reply = await this.resolveNextReply(session.currentState as FlowState, context, message);
    const recentAssistantMessages = session.messages
      .filter((entry) => entry.role === "assistant")
      .slice(-3)
      .map((entry) => entry.content);
    const humanizedReply = reply.skipHumanization
      ? { content: reply.content, aiUsed: false }
      : await this.humanizeReply(reply.state, message, reply.content, recentAssistantMessages, context);
    context.currentState = reply.state;
    const transcript = await buildTranscript(sessionId);
    context.conversationSummary = summarizeConversation(
      transcript
        .split("\n")
        .filter((line: string) => line.startsWith("USER:"))
        .map((line: string) => line.replace(/^USER:\s*/, ""))
    );

    const assistantMessage = createAssistantMessage(humanizedReply.content, reply.citations);
    (assistantMessage as ChatResponse["reply"] & { meta?: { aiUsed: boolean; label: string } }).meta = {
      aiUsed: reply.aiUsed || humanizedReply.aiUsed,
      label: reply.aiUsed || humanizedReply.aiUsed ? "IA" : "sin IA"
    };
    if (env.CHATBOT_TRACE_AI) {
      assistantMessage.meta = {
        ...assistantMessage.meta!,
        trace: {
          analysisAiUsed: reply.trace?.analysisAiUsed ?? reply.aiUsed,
          humanizationAiUsed: humanizedReply.aiUsed,
          baseReply: reply.content,
          finalReply: humanizedReply.content,
          humanizationChanged: reply.content !== humanizedReply.content
        }
      };
    }
    await appendMessage(sessionId, assistantMessage);
    await saveSessionState(sessionId, reply.state, context);

    return {
      sessionId,
      state: reply.state,
      reply: assistantMessage,
      context
    };
  }

  private async resolveNextReply(state: FlowState, context: EngineConversationContext, message: string): Promise<EngineReply> {
    const { analysis, aiUsed: analysisAiUsed } = await this.safeAnalyzeTurn(message);

    switch (state) {
      case "greeting":
      case "intent_detection_fallback": {
        const deterministicIntent = detectIntent(message);
        const intent =
          analysis.isGreeting && deterministicIntent === "unknown"
            ? "unknown"
            : analysis.intent === "unknown"
              ? deterministicIntent
              : analysis.intent;
        context.intent = intent;
        if (analysis.isGreeting && intent === "unknown") {
          return {
            state: "intent_detection_fallback",
            aiUsed: analysisAiUsed,
            trace: { analysisAiUsed },
            content: this.getPrompt("intent_detection_fallback", context)
          };
        }
        if (intent === "incident") {
          return { state: "collect_model", content: this.getPrompt("collect_model", context), aiUsed: analysisAiUsed, trace: { analysisAiUsed } };
        }
        if (intent === "general_info") {
          if (analysis.normalizedModel) {
            context.modelOptional = this.normalizeModelName(analysis.normalizedModel) ?? analysis.normalizedModel;
          }
          const answer = await this.ragService.answerGeneralInformation(message, context.modelOptional);
          return {
            state: "anything_else_offer",
            aiUsed: analysisAiUsed || answer.aiUsed === true,
            skipHumanization: true,
            trace: { analysisAiUsed },
            content: answer.answer
          };
        }
        return {
          state: "intent_detection_fallback",
          aiUsed: analysisAiUsed,
          trace: { analysisAiUsed },
          content: this.getPrompt("intent_detection_fallback", context)
        };
      }

      case "collect_model": {
        const model = this.normalizeModelName(analysis.normalizedModel ?? message.replace(/^modelo\s+/i, "").trim());
        if (!model) {
          return { state: "collect_model", content: this.getPrompt("collect_model", context), aiUsed: analysisAiUsed };
        }
        context.model = model;
        context.modelOptional = model;
        return {
          state: "ask_serial_availability",
          aiUsed: analysisAiUsed,
          content: this.getPrompt("ask_serial_availability", context)
        };
      }

      case "ask_serial_availability": {
        const hasSerial = analysis.yesNo ?? inferSerialAvailability(message);
        const serialCandidate = analysis.serialCandidate ?? this.extractSerialCandidate(message);
        context.userHasSerial = hasSerial;
        if (serialCandidate) {
          return this.resolveNextReply("collect_serial", context, serialCandidate);
        }
        if (hasSerial === false) {
          return {
            state: "troubleshooting_check",
            aiUsed: analysisAiUsed,
            content: flowDefinition.states.troubleshooting_check.prompt
          };
        }
        return { state: "collect_serial", content: this.getPrompt("collect_serial", context), aiUsed: analysisAiUsed };
      }

      case "collect_serial": {
        const serialNumber = analysis.serialCandidate ?? message.trim();
        if (!serialNumber) {
          return { state: "collect_serial", content: this.getPrompt("collect_serial", context), aiUsed: analysisAiUsed };
        }

        context.serialValidationAttempts = (context.serialValidationAttempts ?? 0) + 1;
        context.serialNumber = serialNumber;
        const serialValidation = await checkSerialNumber(serialNumber);
        context.serialExists = serialValidation.exists;
        context.machineRecord = serialValidation.machineRecord;

        if (!serialValidation.exists) {
          if ((context.serialValidationAttempts ?? 0) >= 2) {
            return {
              state: "ask_region_manually",
              aiUsed: analysisAiUsed,
              skipHumanization: true,
              content:
                "No he podido validar ese número tras revisarlo de nuevo. Para no bloquear el caso, voy a continuar con la derivación a un responsable de zona. Indíqueme por favor la zona desde la que nos contacta."
            };
          }

          return {
            state: "collect_serial",
            aiUsed: analysisAiUsed,
            skipHumanization: true,
            content:
              "He revisado ese número de serie o fabricación y no aparece en la base. Compruébelo por favor en la placa del equipo y vuelva a indicármelo."
          };
        }

        const [machine, warranty, assignedWorker] = await Promise.all([
          getMachineBySerial(serialNumber),
          getWarrantyStatus(serialNumber),
          getAssignedWorker({ serialNumber })
        ]);

        context.machine = machine;
        if (machine?.model) {
          context.model = this.normalizeModelName(machine.model) ?? machine.model;
          context.modelOptional = context.model;
        }
        context.warranty = warranty;
        context.assignedWorker = assignedWorker.worker;
        context.serialValidationAttempts = 0;

        return {
          state: "collect_machine_location",
          aiUsed: analysisAiUsed,
          skipHumanization: true,
          content: `Ya he revisado ese número de serie y es correcto. ${this.getPrompt("collect_machine_location", context)}`
        };
      }

      case "collect_machine_location": {
        const location = message.trim();
        context.machineLocation = location;
        context.locationValidationAttempts = (context.locationValidationAttempts ?? 0) + 1;

        const machine = context.machine as
          | {
              region?: { name?: string | null };
              customer?: { city?: string | null };
              assignedWorker?: { id?: string; name?: string; email?: string };
            }
          | undefined;

        const expectedRegionName = machine?.region?.name ?? null;
        const expectedCity = machine?.customer?.city ?? null;
        const resolvedRegionFromInput = analysis.regionCandidate ?? resolveRegionAlias(location) ?? null;
        const locationMatches = this.locationMatchesMachine(location, expectedCity, expectedRegionName);

        if (!locationMatches) {
          if ((context.locationValidationAttempts ?? 0) >= 2) {
            if (resolvedRegionFromInput) {
              context.regionName = resolvedRegionFromInput;
              const workerResolution = await getAssignedWorker({ regionName: resolvedRegionFromInput });
              context.worker = workerResolution.worker;
            } else {
              context.worker = context.assignedWorker;
            }

            context.locationVerified = false;
            return {
              state: "confirm_handoff",
              aiUsed: analysisAiUsed,
              skipHumanization: true,
              content:
                "No he podido contrastar la ubicación con los datos del equipo tras dos comprobaciones. Voy a dejar preparada la derivación a un responsable de zona. ¿Quiere que la prepare?"
            };
          }

          if (resolvedRegionFromInput) {
            context.regionName = resolvedRegionFromInput;
            const workerResolution = await getAssignedWorker({ regionName: resolvedRegionFromInput });
            context.worker = workerResolution.worker;
          } else {
            context.worker = context.assignedWorker;
          }

          context.locationVerified = false;
          return {
            state: "collect_machine_location",
            aiUsed: analysisAiUsed,
            skipHumanization: true,
            content:
              "No he podido contrastar esa ubicación con los datos del equipo. Indíqueme de nuevo la ciudad o provincia donde está instalada la maquinaria."
          };
        }

        context.locationVerified = true;
        context.locationValidationAttempts = 0;
        context.region = (context.machine as { region?: unknown } | undefined)?.region;
        context.worker = context.assignedWorker;

        const warrantyMessage = this.getWarrantyMessage(context);

        return {
          state: "collect_issue_description",
          aiUsed: analysisAiUsed,
          skipHumanization: true,
          content: `He podido contrastar la ubicación del equipo y coincide con los datos registrados. ${warrantyMessage} ${this.getPrompt("collect_issue_description", context)}`
        };
      }

      case "troubleshooting_check": {
        const warrantyMessage = this.getWarrantyMessage(context);

        return {
          state: "collect_issue_description",
          aiUsed: analysisAiUsed,
          content: `${warrantyMessage} ${this.getPrompt("collect_issue_description", context)}`
        };
      }

      case "area_contact_offer": {
        const accepts = analysis.yesNo ?? parseBooleanAnswer(message);
        context.userAccepts = accepts;
        if (this.isUnresolvedGuidanceReply(message)) {
          return {
            state: "area_contact_offer",
            aiUsed: analysisAiUsed,
            content:
              "Entendido. Si las indicaciones del manual no le ayudan, lo adecuado es derivarlo al responsable de zona. ¿Quiere que lo gestione?"
          };
        }

        if (accepts === true) {
          const regionResolution = await getRegionByCustomerOrSerial({
            serialNumber: context.serialNumber,
            machineRecord: (context.machineRecord as { customerId?: string; regionId?: string } | undefined) ?? null
          });

          if (!regionResolution.region || !regionResolution.worker) {
            return {
              state: "ask_region_manually",
              aiUsed: analysisAiUsed,
              content: flowDefinition.states.ask_region_manually.prompt
            };
          }

          context.region = regionResolution.region;
          context.worker = regionResolution.worker;

          if (context.issueDescription?.trim()) {
            return {
              state: "confirm_handoff",
              aiUsed: analysisAiUsed,
              content: `La zona asignada es ${regionResolution.region.name} y el responsable es ${regionResolution.worker.name}. ${this.getPrompt("confirm_handoff", context)}`
            };
          }

          return {
            state: "collect_issue_description",
            aiUsed: analysisAiUsed,
            content: `La zona asignada es ${regionResolution.region.name} y el responsable es ${regionResolution.worker.name}. ${flowDefinition.states.collect_issue_description.prompt}`
          };
        }

        if (accepts === false) {
          return { state: "manual_offer", content: this.getPrompt("manual_offer", context), aiUsed: analysisAiUsed };
        }

        return {
          state: "area_contact_offer",
          aiUsed: analysisAiUsed,
          content: "Para continuar necesito confirmarlo: ¿quiere que el responsable de área se ponga en contacto con usted?"
        };
      }

      case "collect_issue_description": {
        const issueDescription = message.trim();
        if (!issueDescription) {
          return {
            state: "collect_issue_description",
            aiUsed: analysisAiUsed,
            content: flowDefinition.states.collect_issue_description.prompt
          };
        }

        context.issueDescription = issueDescription;
        const guidance = await this.ragService.answerIssueGuidance({
          issueDescription,
          model: context.model,
          serialNumber: context.serialNumber
        });
        context.issueGuidance = guidance.answer;

        if (guidance.needsHumanHandoff) {
          return {
            state: "area_contact_offer",
            aiUsed: analysisAiUsed || guidance.aiUsed === true,
            skipHumanization: true,
            content: `${guidance.answer}\n\n${this.getPrompt("area_contact_offer", context)}`,
            citations: guidance.documents.map((document) => ({
              title: document.title,
              url: document.sourceUrl ?? undefined,
              excerpt: document.content.slice(0, 140)
            }))
          };
        }

        if (guidance.offersManual) {
          return {
            state: "manual_offer",
            aiUsed: analysisAiUsed || guidance.aiUsed === true,
            skipHumanization: true,
            content: guidance.answer,
            citations: guidance.documents.map((document) => ({
              title: document.title,
              url: document.sourceUrl ?? undefined,
              excerpt: document.content.slice(0, 140)
            }))
          };
        }

        return {
          state: "issue_resolution_check",
          aiUsed: analysisAiUsed || guidance.aiUsed === true,
          skipHumanization: true,
          content: `${guidance.answer}\n\n${this.getPrompt("issue_resolution_check", context)}`,
          citations: guidance.documents.map((document) => ({
            title: document.title,
            url: document.sourceUrl ?? undefined,
            excerpt: document.content.slice(0, 140)
          }))
        };
      }

      case "issue_resolution_check": {
        const solved = analysis.yesNo ?? parseBooleanAnswer(message);
        if (solved === true) {
          return {
            state: "manual_offer",
            aiUsed: analysisAiUsed,
            content: `Perfecto. Me alegra que esas comprobaciones hayan ayudado. ${this.getPrompt("manual_offer", context)}`
          };
        }

        if (solved === false) {
          return {
            state: "area_contact_offer",
            aiUsed: analysisAiUsed,
            content: `De acuerdo. Entonces conviene que lo revise el responsable de zona. ${this.getPrompt("area_contact_offer", context)}`
          };
        }

        return {
          state: "issue_resolution_check",
          aiUsed: analysisAiUsed,
          content: this.getPrompt("issue_resolution_check", context)
        };
      }

      case "ask_region_manually": {
        const regionName = analysis.regionCandidate ?? message.trim();
        const workerResolution = await getAssignedWorker({ regionName });
        context.regionName = regionName;
        context.worker = workerResolution.worker;
        if (!workerResolution.worker) {
          return {
            state: "ask_region_manually",
            aiUsed: analysisAiUsed,
            content: "No he podido resolver esa zona. Indíqueme por favor Andalucia, Centro o Levante."
          };
        }

        if (context.issueDescription?.trim()) {
          return {
            state: "confirm_handoff",
            aiUsed: analysisAiUsed,
            content: `He localizado al responsable asignado: ${workerResolution.worker.name}. ${this.getPrompt("confirm_handoff", context)}`
          };
        }

        return {
          state: "collect_issue_description",
          aiUsed: analysisAiUsed,
          content: `He localizado al responsable asignado: ${workerResolution.worker.name}. ${flowDefinition.states.collect_issue_description.prompt}`
        };
      }

      case "confirm_handoff": {
        const accepts = analysis.yesNo ?? parseBooleanAnswer(message);
        if (accepts !== true) {
          return { state: "manual_offer", content: this.getPrompt("manual_offer", context), aiUsed: analysisAiUsed };
        }

        if (!context.issueDescription?.trim()) {
          return {
            state: "collect_issue_description",
            aiUsed: analysisAiUsed,
            content: flowDefinition.states.collect_issue_description.prompt
          };
        }

        const incidentResult = await createIncident({
          sessionId: context.sessionId,
          serialNumber: context.serialNumber,
          locality:
            context.machineLocation ??
            ((context.machine as { customer?: { city?: string | null } } | undefined)?.customer?.city ?? undefined),
          model: context.model ?? "Modelo no indicado",
          region: (context.region as { name?: string } | undefined) ?? null,
          assignedWorkerId: (context.worker as { id?: string } | undefined)?.id ?? null,
          issueSummary: context.issueDescription ?? context.conversationSummary ?? context.lastUserMessage ?? "Incidencia de postventa"
        });
        context.incident = incidentResult.incident;

        const summaryLines = [
          `Modelo: ${context.model ?? "No indicado"}`,
          `Serie: ${context.serialNumber ?? "(no aportado)"}`,
          `Localidad: ${
            context.machineLocation ??
            ((context.machine as { customer?: { city?: string | null } } | undefined)?.customer?.city ?? "(no aportada)")
          }`,
          `Incidencia: ${context.issueDescription ?? "No indicada"}`,
          `Resumen: ${context.conversationSummary ?? "Pendiente"}`
        ];

        const handoff = await generateHumanHandoffPayload({
          sessionId: context.sessionId,
          incidentId: incidentResult.incident.id,
          summaryLines
        });

        if ((context.worker as { email?: string } | undefined)?.email) {
          await sendConversationEmail({
            to: (context.worker as { email: string }).email,
            summary: handoff.handoff.summary,
            transcript: await buildTranscript(context.sessionId)
          });
        }

        await sendTelegramIncidentNotification({
          incidentId: incidentResult.incident.id,
          workerId: (context.worker as { id?: string } | undefined)?.id ?? null,
          workerName: (context.worker as { name?: string } | undefined)?.name ?? null,
          model: context.model ?? "Modelo no indicado",
          serialNumber: context.serialNumber,
          locality:
            context.machineLocation ??
            ((context.machine as { customer?: { city?: string | null } } | undefined)?.customer?.city ?? undefined),
          regionName: (context.region as { name?: string } | undefined)?.name ?? context.regionName ?? null,
          summary: context.issueDescription?.trim() || context.conversationSummary || context.lastUserMessage || "Incidencia de postventa"
        });

        return {
          state: "anything_else_offer",
          aiUsed: analysisAiUsed,
          content: `He dejado creada la incidencia mock ${incidentResult.incident.reference}. El responsable de zona revisará el caso con los datos facilitados. ${this.getPrompt("anything_else_offer", context)}`
        };
      }

      case "manual_offer": {
        const accepts = analysis.yesNo ?? parseBooleanAnswer(message);
        if (accepts !== true) {
          return { state: "anything_else_offer", content: this.getPrompt("anything_else_offer", context), aiUsed: analysisAiUsed };
        }

        const manualResult = await getManualForModel({
          model: context.model,
          serialNumber: context.serialNumber
        });
        context.manual = manualResult.manual;
        if (!manualResult.manual) {
          return {
            state: context.issueDescription?.trim() ? "area_contact_offer" : "anything_else_offer",
            aiUsed: analysisAiUsed,
            content:
              `No he podido localizar el manual exacto con los datos actuales. Si lo desea, puedo dejar preparado el caso para revisión manual. ${
                context.issueDescription?.trim() ? this.getPrompt("area_contact_offer", context) : this.getPrompt("anything_else_offer", context)
              }`
          };
        }

        return {
          state: context.issueDescription?.trim() ? "manual_resolution_check" : "anything_else_offer",
          aiUsed: analysisAiUsed,
          content: `He localizado el manual correspondiente: [${manualResult.manual.title}](${this.getManualPublicUrl(
            manualResult.manual.id
          )}). ${
            context.issueDescription?.trim() ? this.getPrompt("manual_resolution_check", context) : this.getPrompt("anything_else_offer", context)
          }`
        };
      }

      case "manual_resolution_check": {
        const solved = analysis.yesNo ?? parseBooleanAnswer(message);
        if (solved === true) {
          return {
            state: "anything_else_offer",
            aiUsed: analysisAiUsed,
            content: `Perfecto. Me alegra que el manual le haya servido. ${this.getPrompt("anything_else_offer", context)}`
          };
        }

        if (solved === false || this.isUnresolvedGuidanceReply(message)) {
          return {
            state: "area_contact_offer",
            aiUsed: analysisAiUsed,
            content: `De acuerdo. Entonces conviene que lo revise el responsable de zona. ${this.getPrompt("area_contact_offer", context)}`
          };
        }

        return {
          state: "manual_resolution_check",
          aiUsed: analysisAiUsed,
          content: "Necesito confirmarlo para continuar: ¿la incidencia ha quedado resuelta? Si no, la derivo al responsable de zona."
        };
      }

      case "anything_else_offer": {
        const nextIntent = analysis.intent === "unknown" ? detectIntent(message) : analysis.intent;
        if (analysis.normalizedModel) {
          const normalizedModel = this.normalizeModelName(analysis.normalizedModel) ?? analysis.normalizedModel;
          context.modelOptional = normalizedModel;
          context.model = context.model ?? normalizedModel;

          if (nextIntent !== "incident") {
            context.intent = "general_info";
            const answer = await this.ragService.answerGeneralInformation(
              `información general sobre ${normalizedModel}`,
              normalizedModel
            );
            return {
              state: "anything_else_offer",
              aiUsed: analysisAiUsed || answer.aiUsed === true,
              skipHumanization: true,
              content: answer.answer
            };
          }
        }

        if (nextIntent === "incident") {
          context.intent = "incident";
          context.conversationClosed = false;
          return {
            state: "collect_model",
            aiUsed: analysisAiUsed,
            content: this.getPrompt("collect_model", context)
          };
        }

        if (nextIntent === "general_info") {
          context.intent = "general_info";
          const answer = await this.ragService.answerGeneralInformation(message, context.modelOptional);
          return {
            state: "anything_else_offer",
            aiUsed: analysisAiUsed || answer.aiUsed === true,
            skipHumanization: true,
            content: answer.answer
          };
        }

        const wantsMoreHelp = analysis.yesNo ?? parseBooleanAnswer(message);
        if (wantsMoreHelp === true) {
          context.conversationClosed = false;
          return {
            state: "greeting",
            aiUsed: analysisAiUsed,
            content: `Perfecto. ${this.getPrompt("greeting", context)}`
          };
        }

        if (wantsMoreHelp === false) {
          return {
            state: "collect_rating",
            aiUsed: analysisAiUsed,
            content: this.getPrompt("collect_rating", context)
          };
        }

        return {
          state: "anything_else_offer",
          aiUsed: analysisAiUsed,
          content: this.getPrompt("anything_else_offer", context)
        };
      }

      case "collect_rating": {
        const rating = parseRating(message);
        if (!rating) {
          return {
            state: "collect_rating",
            aiUsed: analysisAiUsed,
            content: this.getPrompt("collect_rating", context)
          };
        }

        context.satisfactionRating = rating;
        context.conversationClosed = true;
        return {
          state: "closing",
          aiUsed: analysisAiUsed,
          content: this.getPrompt("closing", context)
        };
      }

      case "closing": {
        const intent = analysis.intent === "unknown" ? detectIntent(message) : analysis.intent;
        context.intent = intent;
        if (intent === "general_info") {
          if (analysis.normalizedModel) {
            context.modelOptional = this.normalizeModelName(analysis.normalizedModel) ?? analysis.normalizedModel;
          }
          const answer = await this.ragService.answerGeneralInformation(message, context.modelOptional);
          return {
            state: "anything_else_offer",
            aiUsed: analysisAiUsed || answer.aiUsed === true,
            skipHumanization: true,
            content: answer.answer
          };
        }
        return {
          state: "greeting",
          aiUsed: analysisAiUsed,
          content: this.getPrompt("greeting", context)
        };
      }
    }

    return {
      state: "closing",
      aiUsed: false,
      content: this.getPrompt("closing", context)
    };
  }

  private async humanizeReply(
    state: FlowState,
    userMessage: string,
    baseReply: string,
    recentAssistantMessages: string[],
    context: EngineConversationContext
  ) {
    const requireGreeting = (state === "greeting" || state === "intent_detection_fallback") && this.shouldForceGreeting(userMessage);
    try {
      const content = await this.conversationalAI.humanizeReply({
        state,
        userMessage,
        baseReply,
        recentAssistantMessages,
        requireGreeting
      });
      const contentWithGreeting = this.ensureGreetingIfNeeded(content, requireGreeting);
      const finalContent = requireGreeting ? contentWithGreeting : this.removeUnexpectedGreeting(contentWithGreeting, baseReply);

      if (!this.isHumanizationSafe(state, baseReply, finalContent, context)) {
        return {
          content: this.ensureGreetingIfNeeded(baseReply, requireGreeting),
          aiUsed: false
        };
      }

      return {
        content: finalContent,
        aiUsed: this.conversationalAI.isEnabled()
      };
    } catch {
      return {
        content: this.ensureGreetingIfNeeded(baseReply, requireGreeting),
        aiUsed: false
      };
    }
  }

  private async safeAnalyzeTurn(message: string) {
    try {
      const analysis = await this.conversationalAI.analyzeTurn(message);
      const deterministicAnalysis = await this.deterministicAI.analyzeTurn(message);
      return {
        analysis: {
          ...analysis,
          intent: analysis.intent === "unknown" ? deterministicAnalysis.intent : analysis.intent,
          yesNo: analysis.yesNo ?? deterministicAnalysis.yesNo,
          normalizedModel: analysis.normalizedModel ?? deterministicAnalysis.normalizedModel,
          serialCandidate: analysis.serialCandidate ?? deterministicAnalysis.serialCandidate,
          regionCandidate: analysis.regionCandidate ?? deterministicAnalysis.regionCandidate
        },
        aiUsed: this.conversationalAI.isEnabled()
      };
    } catch {
      const analysis = await this.deterministicAI.analyzeTurn(message);
      return {
        analysis,
        aiUsed: false
      };
    }
  }

  private getWarrantyMessage(context: EngineConversationContext) {
    return context.warranty?.status === "in_warranty"
      ? "El equipo figura en periodo de garantía."
      : context.warranty?.status === "out_of_warranty"
        ? "El equipo no figura en periodo de garantía."
        : "No he podido confirmar el estado de garantía con los datos actuales.";
  }

  private locationMatchesMachine(location: string, expectedCity?: string | null, expectedRegion?: string | null) {
    const normalizedLocation = normalizeText(location);
    const normalizedExpectedCity = expectedCity ? normalizeText(expectedCity) : "";
    const resolvedInputRegion = resolveRegionAlias(location);

    if (expectedRegion && resolvedInputRegion === expectedRegion) {
      return true;
    }

    if (normalizedExpectedCity && normalizedExpectedCity.includes(normalizedLocation)) {
      return true;
    }

    const cityTokens = normalizedExpectedCity.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    return cityTokens.some((token) => normalizedLocation.includes(token) || token.includes(normalizedLocation));
  }

  private getPrompt(state: FlowState, context: EngineConversationContext) {
    const usage = context.promptUsage ?? {};
    const stateUsage = usage[state] ?? 0;
    context.promptUsage = {
      ...usage,
      [state]: stateUsage + 1
    };

    const variants = this.promptVariants[state];
    if (!variants?.length) {
      return flowDefinition.states[state].prompt;
    }

    const sessionOffset = Array.from(context.sessionId).reduce((total, char) => total + char.charCodeAt(0), 0);
    return variants[(sessionOffset + stateUsage) % variants.length] ?? flowDefinition.states[state].prompt;
  }

  private shouldForceGreeting(message: string) {
    const normalized = normalizeText(message);
    return /\bhola\b|\bbuenas\b|\bbuenos dias\b|\bbuenas tardes\b|\bque tal\b/.test(normalized);
  }

  private extractSerialCandidate(message: string) {
    const candidates = message
      .match(/[A-Z0-9][A-Z0-9-]{3,}/gi)
      ?.map((candidate) => candidate.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter((candidate) => /\d/.test(candidate));

    return candidates?.[0] ?? null;
  }

  private ensureGreetingIfNeeded(content: string, required: boolean) {
    if (!required || /\bhola\b|\bbuenas\b/i.test(content)) {
      return content;
    }

    return `Hola. ${content}`;
  }

  private removeUnexpectedGreeting(content: string, baseReply: string) {
    if (/^\s*(hola|buenas)\b/i.test(baseReply)) {
      return content;
    }

    return content.replace(/^\s*(hola|buenas(?:\s+d[ií]as|\s+tardes|\s+noches)?)[,.!\s]+/i, "").trim();
  }

  private isUnresolvedGuidanceReply(message: string) {
    const normalized = normalizeText(message);
    return (
      /no me ayuda|no sirve|no ha servido|no soluciona|no resuelve|sigue igual|sigue fallando|continua fallando|continua con el fallo|continua el problema|persiste|continua|continúa/.test(normalized) ||
      /quiero hablar|contactar|responsable|derivar|escalar/.test(normalized)
    );
  }

  private isHumanizationSafe(
    state: FlowState,
    baseReply: string,
    candidateReply: string,
    context: EngineConversationContext
  ) {
    const normalizedBase = normalizeText(baseReply);
    const normalizedCandidate = normalizeText(candidateReply);

    const questionStates: FlowState[] = [
      "collect_model",
      "ask_serial_availability",
      "collect_serial",
      "collect_machine_location",
      "area_contact_offer",
      "confirm_handoff",
      "manual_offer",
      "manual_resolution_check",
      "issue_resolution_check",
      "anything_else_offer",
      "collect_rating"
    ];

    if (questionStates.includes(state) && !candidateReply.includes("?")) {
      return false;
    }

    if (state === "manual_offer") {
      const forbiddenPhrases = ["he localizado el manual", "le envio el manual", "le envío el manual", "puede consultarlo aqui"];
      if (forbiddenPhrases.some((phrase) => normalizedCandidate.includes(normalizeText(phrase)))) {
        return false;
      }
    }

    if (state === "confirm_handoff") {
      const forbiddenPhrases = ["incidencia mock", "he dejado creada", "he creado la incidencia"];
      if (forbiddenPhrases.some((phrase) => normalizedCandidate.includes(normalizeText(phrase)))) {
        return false;
      }
    }

    if (state === "anything_else_offer") {
      const forbiddenPhrases = ["no he podido localizar el manual", "manual exacto", "dejar preparado el caso"];
      if (forbiddenPhrases.some((phrase) => normalizedCandidate.includes(normalizeText(phrase)))) {
        return false;
      }
    }

    if (
      state === "issue_resolution_check" &&
      (!/manual|documentacion|documentación|comprob/i.test(candidateReply) ||
        !/resuelto|solucionado|funcionando|responsable|derivaci[oó]n/i.test(candidateReply))
    ) {
      return false;
    }

    if (state === "collect_rating" && !/1 a 5|estrellas|valora|valoracion/.test(normalizedCandidate)) {
      return false;
    }

    if (normalizedBase.includes("manual oficial") && !/manual oficial|pdf oficial|fuentes|manual/i.test(candidateReply)) {
      return false;
    }

    if (/documentaci[oó]n autorizada|motor determinista|rag|base estructurada|herramientas/i.test(candidateReply)) {
      return false;
    }

    if (normalizedBase.includes("fuentes:") && !normalizedCandidate.includes("fuentes:")) {
      return false;
    }

    if (!normalizedBase.includes("fuentes:") && normalizedCandidate.includes("fuentes:")) {
      return false;
    }

    if (normalizedBase.includes("garantia") && !normalizedCandidate.includes("garantia")) {
      return false;
    }

    if (normalizedBase.includes("responsable") && !normalizedCandidate.includes("responsable")) {
      return false;
    }

    const protectedTerms = this.extractProtectedTerms(baseReply, context);
    if (protectedTerms.some((term) => !candidateReply.includes(term))) {
      return false;
    }

    return true;
  }

  /**
   * Términos que la humanización no puede perder: referencias, URLs y cifras se
   * detectan en el propio texto, y los datos operativos críticos se derivan del
   * contexto de la conversación en lugar de listas codificadas en el motor.
   */
  private extractProtectedTerms(baseReply: string, context: EngineConversationContext) {
    const terms = new Set<string>();
    const patterns = [/INC-[\d-]+/g, /https?:\/\/\S+/g, /\b\d{4,}\b/g];

    for (const pattern of patterns) {
      for (const match of baseReply.matchAll(pattern)) {
        terms.add(match[0].replace(/[.,;:!?)]$/, ""));
      }
    }

    const contextualTerms = [
      (context.worker as { name?: string } | undefined)?.name,
      (context.assignedWorker as { name?: string } | undefined)?.name,
      (context.region as { name?: string } | undefined)?.name,
      context.regionName,
      context.serialNumber
    ];

    for (const term of contextualTerms) {
      const candidate = term?.trim();
      if (candidate && candidate.length > 2 && baseReply.includes(candidate)) {
        terms.add(candidate);
      }
    }

    return Array.from(terms);
  }
}
