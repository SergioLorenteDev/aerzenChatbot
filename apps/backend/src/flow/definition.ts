export const flowDefinition = {
  flowId: "aerzen_postventa_v1",
  initialState: "greeting",
  states: {
    greeting: {
      prompt: "Soy el asistente de postventa de AERZEN Iberica. ¿Tiene una incidencia con su máquina o necesita información general?"
    },
    intent_detection_fallback: {
      prompt:
        "Para ayudarle mejor, necesito saber si se trata de una incidencia con su equipo o de una consulta informativa general."
    },
    collect_model: {
      prompt: "Indíqueme por favor el modelo de su equipo. Por ejemplo: GM 35."
    },
    ask_serial_availability: {
      prompt: "¿Dispone del número de fabricación o número de serie? Suele encontrarse en la placa del equipo."
    },
    collect_serial: {
      prompt: "Indíqueme por favor el número de fabricación o serie."
    },
    collect_machine_location: {
      prompt: "Indíqueme por favor la ciudad o provincia donde está instalada la maquinaria."
    },
    troubleshooting_check: {
      prompt:
        "Antes de continuar, ¿ha revisado los puntos básicos de avería que aparecen en el manual de su equipo?"
    },
    area_contact_offer: {
      prompt: "¿Desea que se ponga en contacto con usted el responsable de área?"
    },
    collect_issue_description: {
      prompt: "Indíqueme brevemente qué le ocurre al equipo."
    },
    issue_resolution_check: {
      prompt: "¿Con estas comprobaciones se ha resuelto la incidencia?"
    },
    ask_region_manually: {
      prompt: "Indíqueme por favor la zona desde la que nos contacta."
    },
    confirm_handoff: {
      prompt: "He localizado la zona y el responsable asignado. ¿Quiere que prepare la derivación de este caso?"
    },
    manual_offer: {
      prompt: "¿Desea que le facilitemos el manual de su equipo?"
    },
    manual_resolution_check: {
      prompt: "Después de revisar el manual, ¿la incidencia ha quedado resuelta? Si no se ha resuelto, le paso con el responsable de zona."
    },
    anything_else_offer: {
      prompt: "¿Necesita algo más sobre este equipo o sobre otra máquina?"
    },
    collect_rating: {
      prompt: "Antes de cerrar, ¿cómo valora la atención recibida? Puede indicarme de 1 a 5 estrellas."
    },
    closing: {
      prompt: "Gracias por su valoración. Doy por cerrada la conversación. Quedo a su disposición para futuras consultas."
    }
  }
} as const;

export type FlowState = keyof typeof flowDefinition.states;
