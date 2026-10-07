import { PrismaClient } from "@prisma/client";
import { importAvailableManuals } from "../scripts/import_manual_documents.ts";

const prisma = new PrismaClient();

/**
 * Este seed VACÍA las tablas antes de cargar los datos de demostración.
 * Por seguridad solo se permite automáticamente contra una base de datos local;
 * para cualquier host remoto hay que autorizarlo de forma explícita.
 */
function assertSafeToWipe() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const looksRemote =
    /^postgres(ql)?:\/\//.test(databaseUrl) &&
    !/@(localhost|127\.0\.0\.1|host\.docker\.internal|db)(:|\/)/.test(databaseUrl);

  if (looksRemote && process.env.SEED_ALLOW_WIPE !== "1") {
    throw new Error(
      [
        "Se ha bloqueado el seed porque DATABASE_URL apunta a un host que no es local.",
        "Este script borra todas las tablas antes de cargar los datos de demostración.",
        "Si realmente quieres vaciar esa base de datos, ejecútalo con SEED_ALLOW_WIPE=1."
      ].join("\n")
    );
  }
}

async function main() {
  assertSafeToWipe();

  await prisma.conversationMessage.deleteMany();
  await prisma.conversationSession.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.authorizedDocument.deleteMany();
  await prisma.manual.deleteMany();
  await prisma.machine.deleteMany();
  await prisma.technicalDataSheet.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.region.deleteMany();

  const [andalucia, centro, levante] = await Promise.all([
    prisma.region.create({ data: { name: "Andalucia, Extremadura y Canarias" } }),
    prisma.region.create({ data: { name: "Centro y Castilla La Mancha" } }),
    prisma.region.create({ data: { name: "Levante, Cataluña, Pais Vasco" } })
  ]);

  const [ana, luis, marta] = await Promise.all([
    prisma.worker.create({
      data: {
        name: "Ana Ferrer",
        email: "ana.ferrer@example.mock",
        telegramChatId: "telegram-chat-ana",
        regions: { connect: [{ id: andalucia.id }] }
      }
    }),
    prisma.worker.create({
      data: {
        name: "Luis Cano",
        email: "luis.cano@example.mock",
        telegramChatId: "telegram-chat-luis",
        regions: { connect: [{ id: centro.id }] }
      }
    }),
    prisma.worker.create({
      data: {
        name: "Marta Rios",
        email: "marta.rios@example.mock",
        telegramChatId: "telegram-chat-marta",
        regions: { connect: [{ id: levante.id }] }
      }
    })
  ]);

  const [clienteSur, clienteCentro, clienteNorte, clienteDemo, clienteBebidas, clienteAerolineas] = await Promise.all([
    prisma.customer.create({
      data: { name: "Oleica Andaluza S.L.", email: "mantenimiento@oleica.mock", regionId: andalucia.id }
    }),
    prisma.customer.create({
      data: { name: "Quimica Manchega S.L.", email: "sat@quimicamanchega.mock", regionId: centro.id }
    }),
    prisma.customer.create({
      data: { name: "Papelera Cantabra S.L.", email: "planta@papeleracantabra.mock", regionId: levante.id }
    }),
    prisma.customer.create({
      data: {
        name: "Planta Demo Industrial S.L.",
        externalCode: "0000000001",
        city: "28999 Ciudad Demo (Madrid)",
        regionId: centro.id
      }
    }),
    prisma.customer.create({
      data: {
        name: "Bebidas Peninsulares S.A.",
        city: "Madrid",
        regionId: centro.id
      }
    }),
    prisma.customer.create({
      data: {
        name: "Aerolineas Meridiana S.A.",
        city: "Madrid",
        regionId: centro.id
      }
    })
  ]);

  const pi15TechnicalDataSheet = await prisma.technicalDataSheet.create({
    data: {
      sourceName: "ficha-tecnica-demo.pdf",
      title: "Technical Data Compressor - PI1.5 AWK CL FDA GJL R Z",
      model: "PI1.5 AWK CL FDA GJL R Z",
      typeCode: "PI1.5 AWK CL FDA GJL R Z",
      customerId: clienteDemo.id,
      customerCode: "0000000001",
      customerName: "Planta Demo Industrial S.L.",
      customerCity: "28999 Ciudad Demo (Madrid)",
      sapOrderNumber: "000000",
      sapOrderPosition: "000",
      customerOrderNumber: "DEMO-PO-0001 / DEMO-SO-0001",
      language: "en",
      rawSummary:
        "Ficha técnica de demostración del compresor AERZEN tipo PI1.5 AWK CL FDA GJL R Z para el cliente 0000000001 Planta Demo Industrial S.L. Incluye operación case A y B, parámetros de proceso, tolerancias, inspección y relación FBNR/SRNR/EquipmentNo con los equipos 9000001, 9000002 y 9000003.",
      operationCases: {
        caseA: {
          item: "000000000",
          sequenceNo: 0,
          adjustment: "DH G1",
          builtInPressureRatio: 1.5,
          gearRatioNumber: "i_8/1",
          gearRatio: 2.5,
          nominalSize: 100,
          inletType: "Raum",
          application: "DEMO",
          spareLine: "Farbton: RAL 5001, Menge: 1.5kg",
          conveyingMeans: "Luft/Air",
          densityKgM3: 1.089,
          volumeFlowQ1M3Min: 4.2,
          inletTemperatureC: 20,
          outletTemperatureC: 105,
          altitudeM: 650,
          absPressureInletP1Bar: 0.95,
          absPressureOutletP2Bar: 1.75,
          outletOverpressureP2eBar: 0.8,
          pressureDifferenceMbar: 800,
          powerRequirementKw: 9.5,
          maleRotorSpeedRpm: 8500,
          soundPressureDbA: 70,
          motorRatingKw: 11,
          motorSpeedRpm: 2900
        },
        caseB: {
          item: "000000000",
          sequenceNo: 0,
          adjustment: "DH G1",
          builtInPressureRatio: 1.5,
          gearRatioNumber: "i_8/1",
          gearRatio: 2.5,
          nominalSize: 100,
          inletType: "Raum",
          application: "DEMO",
          spareLine: "Farbton: RAL 5001, Menge: 1.5kg",
          conveyingMeans: "Luft/Air",
          densityKgM3: 1.089,
          volumeFlowQ1M3Min: 1.8,
          inletTemperatureC: 20,
          outletTemperatureC: 165,
          altitudeM: 650,
          absPressureInletP1Bar: 0.95,
          absPressureOutletP2Bar: 1.75,
          outletOverpressureP2eBar: 0.8,
          pressureDifferenceMbar: 800,
          powerRequirementKw: 5.2,
          maleRotorSpeedRpm: 4500,
          motorRatingKw: 0,
          motorSpeedRpm: 1500
        }
      },
      inspectionData: {
        toleranceOilPercent: "up:-5.00 to 5.00",
        tolerancePPercent: "up:-5.00 to 5.00",
        valveSetPressureMbar: 900,
        weightKg: 480,
        suctionValveAdjustmentAF0341Mbar: 0,
        oilVolumeLtr: 1.8,
        unloadedOperationControl: "0 = without",
        gasConstantJKgK: 287.05,
        polytropExponentCbCv: 0,
        relativeHumidityPercent: 0,
        pindPerformanceKw: 0,
        testingAcc: "QP0024",
        resistanceInletFlowMbarP1: 0,
        resistanceOutletFlowMbarP2: 0,
        inspectionLegend:
          "(1,3,5,4,6,8,9) 1= pressure test 3 = test run 5 = final inspection 4-9 = combination of 1,3,5",
        linkedEquipments: [
          { fabricationNumber: "170001", serialNumber: "9000001", equipmentNumber: "9000001", date: "2020-03-10" },
          { fabricationNumber: "170002", serialNumber: "9000002", equipmentNumber: "9000002", date: "2020-03-10" },
          { fabricationNumber: "170003", serialNumber: "9000003", equipmentNumber: "9000003", date: "2020-03-10" }
        ]
      },
      sourceCapturedAt: new Date("2026-01-15T10:00:00Z")
    }
  });

  await prisma.machine.createMany({
    data: [
      {
        model: "GM 35",
        serialNumber: "GM35-ES-0001",
        fabricationCode: "FAB-GM35-0001",
        installedAt: new Date("2025-03-15"),
        warrantyStart: new Date("2025-03-15"),
        warrantyEnd: new Date("2027-03-15"),
        customerId: clienteSur.id,
        regionId: andalucia.id,
        assignedWorkerId: ana.id
      },
      {
        model: "Delta Hybrid D52",
        serialNumber: "DH52-ES-1044",
        fabricationCode: "FAB-DH52-1044",
        installedAt: new Date("2021-06-20"),
        warrantyStart: new Date("2021-06-20"),
        warrantyEnd: new Date("2023-06-20"),
        customerId: clienteCentro.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "VMX 160",
        serialNumber: "VMX160-ES-7788",
        fabricationCode: "FAB-VMX160-7788",
        installedAt: new Date("2024-09-02"),
        warrantyStart: new Date("2024-09-02"),
        warrantyEnd: new Date("2026-09-02"),
        customerId: clienteNorte.id,
        regionId: levante.id,
        assignedWorkerId: marta.id
      },
      {
        model: "PI1.5 AWK CL FDA GJL R Z",
        serialNumber: "9000001",
        fabricationCode: "170001",
        equipmentNumber: "9000001",
        installedAt: new Date("2020-03-10"),
        customerId: clienteDemo.id,
        regionId: centro.id,
        assignedWorkerId: ana.id,
        technicalDataSheetId: pi15TechnicalDataSheet.id
      },
      {
        model: "PI1.5 AWK CL FDA GJL R Z",
        serialNumber: "9000002",
        fabricationCode: "170002",
        equipmentNumber: "9000002",
        installedAt: new Date("2020-03-10"),
        customerId: clienteDemo.id,
        regionId: centro.id,
        assignedWorkerId: ana.id,
        technicalDataSheetId: pi15TechnicalDataSheet.id
      },
      {
        model: "PI1.5 AWK CL FDA GJL R Z",
        serialNumber: "9000003",
        fabricationCode: "170003",
        equipmentNumber: "9000003",
        installedAt: new Date("2020-03-10"),
        customerId: clienteDemo.id,
        regionId: centro.id,
        assignedWorkerId: ana.id,
        technicalDataSheetId: pi15TechnicalDataSheet.id
      },
      {
        model: "Delta Hybrid",
        serialNumber: "11122",
        fabricationCode: "FAB-DH-11122",
        installedAt: new Date("2024-01-15"),
        customerId: clienteBebidas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "Delta Hybrid",
        serialNumber: "11133",
        fabricationCode: "FAB-DH-11133",
        installedAt: new Date("2024-01-15"),
        customerId: clienteBebidas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "Delta Hybrid",
        serialNumber: "11144",
        fabricationCode: "FAB-DH-11144",
        installedAt: new Date("2024-01-15"),
        customerId: clienteBebidas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "Delta Hybrid",
        serialNumber: "11155",
        fabricationCode: "FAB-DH-11155",
        installedAt: new Date("2024-01-15"),
        customerId: clienteBebidas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "Delta Blower",
        serialNumber: "22211",
        fabricationCode: "FAB-DB-22211",
        installedAt: new Date("2024-02-20"),
        customerId: clienteAerolineas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "Delta Blower",
        serialNumber: "22233",
        fabricationCode: "FAB-DB-22233",
        installedAt: new Date("2024-02-20"),
        customerId: clienteAerolineas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "Delta Blower",
        serialNumber: "22244",
        fabricationCode: "FAB-DB-22244",
        installedAt: new Date("2024-02-20"),
        customerId: clienteAerolineas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      },
      {
        model: "Delta Blower",
        serialNumber: "22255",
        fabricationCode: "FAB-DB-22255",
        installedAt: new Date("2024-02-20"),
        customerId: clienteAerolineas.id,
        regionId: centro.id,
        assignedWorkerId: luis.id
      }
    ]
  });

  await prisma.manual.createMany({
    data: [
      {
        model: "Delta Blower",
        title: "Manual de servicio Delta Blower",
        fileUrl: "https://docs.example.com/manuales/delta-blower-es.pdf",
        description: "Manual técnico autorizado para Delta Blower"
      },
      {
        model: "GM 35",
        title: "Manual de operación GM 35",
        fileUrl: "https://docs.example.com/manuales/gm-35-es.pdf",
        description: "Manual de operación y mantenimiento del modelo GM 35"
      },
      {
        model: "Delta Hybrid D52",
        title: "Manual de operación Delta Hybrid D52",
        fileUrl: "https://docs.example.com/manuales/delta-hybrid-d52-es.pdf",
        description: "Manual técnico autorizado para Delta Hybrid D52"
      },
      {
        model: "VMX 160",
        title: "Manual de operación VMX 160",
        fileUrl: "https://docs.example.com/manuales/vmx-160-es.pdf",
        description: "Manual técnico autorizado para VMX 160"
      }
    ]
  });

  await prisma.authorizedDocument.createMany({
    data: [
      {
        title: "Guía de garantía estándar",
        content:
          "La garantía estándar cubre defectos de fabricación dentro del periodo contratado. La validación final de cobertura debe realizarse siempre contra el número de serie registrado y la fecha de puesta en marcha.",
        sourceUrl: "https://docs.example.com/garantia-estandar"
      },
      {
        title: "Guía de localización de placa de características",
        model: "GM 35",
        content:
          "En el modelo GM 35 la placa del equipo suele encontrarse en el lateral de la carcasa principal, junto al bloque de conexión. Incluye modelo, número de fabricación y datos eléctricos.",
        sourceUrl: "https://docs.example.com/gm35/placa"
      },
      {
        title: "Puntos básicos de avería Delta Hybrid D52",
        model: "Delta Hybrid D52",
        content:
          "Antes de abrir incidencia revise alimentación, presión diferencial, alarmas activas y estado del filtro de aspiración. Estos pasos iniciales están recogidos en el manual autorizado.",
        sourceUrl: "https://docs.example.com/d52/averias-basicas"
      },
      {
        title: "Intervalos de mantenimiento VMX 160",
        model: "VMX 160",
        content:
          "Para el modelo VMX 160 se recomienda revisión visual diaria, control de vibraciones y revisión periódica según las horas de servicio indicadas en el manual.",
        sourceUrl: "https://docs.example.com/vmx160/mantenimiento"
      },
      {
        title: "Ficha técnica PI1.5 AWK CL FDA GJL R Z - Operación A",
        model: "PI1.5 AWK CL FDA GJL R Z",
        content:
          "Documento de demostración del compresor tipo PI1.5 AWK CL FDA GJL R Z. Caso de operación A del item 000000000: ajuste DH G1, volumen Q1 4.20 m3/min, temperatura de entrada 20 C, temperatura de salida 105 C, presión absoluta p1 0.950 bar, p2 1.750 bar, sobrepresión p2e 0.800 bar, diferencia de presión 800 mbar, potencia requerida 9.50 kW, velocidad de rotor 8500 1/min, motor 11 kW a 2900 1/min, nivel sonoro 70 dB(A).",
        sourceUrl: "local://ficha-tecnica-demo.pdf#page=1"
      },
      {
        title: "Ficha técnica PI1.5 AWK CL FDA GJL R Z - Operación B",
        model: "PI1.5 AWK CL FDA GJL R Z",
        content:
          "Documento de demostración del compresor tipo PI1.5 AWK CL FDA GJL R Z. Caso de operación B del item 000000000: ajuste DH G1, volumen Q1 1.80 m3/min, temperatura de entrada 20 C, temperatura de salida 165 C, presión absoluta p1 0.950 bar, p2 1.750 bar, sobrepresión p2e 0.800 bar, diferencia de presión 800 mbar, potencia requerida 5.20 kW, velocidad de rotor 4500 1/min, velocidad de motor 1500 1/min y nivel sonoro 70 dB(A).",
        sourceUrl: "local://ficha-tecnica-demo.pdf#page=3"
      },
      {
        title: "Relación FBNR y SRNR PI1.5 AWK CL FDA GJL R Z",
        model: "PI1.5 AWK CL FDA GJL R Z",
        content:
          "Relación estructurada de demostración. FBNR 170001 corresponde al SRNR 9000001 y EquipmentNo 9000001. FBNR 170002 corresponde al SRNR 9000002 y EquipmentNo 9000002. FBNR 170003 corresponde al SRNR 9000003 y EquipmentNo 9000003. Cliente 0000000001 Planta Demo Industrial S.L. en Ciudad Demo (Madrid).",
        sourceUrl: "local://ficha-tecnica-demo.pdf#page=4"
      },
      {
        title: "Web oficial AERZEN - Productos y aplicaciones",
        content:
          "La web oficial de AERZEN presenta su catálogo de soplantes de desplazamiento positivo, compresores de tornillo, soplantes de tornillo y turbosoplantes. También indica que ofrece soluciones para múltiples procesos industriales y que trabaja en innovación, optimización y fabricación de sus equipos desde 1864.",
        sourceUrl: "https://www.aerzen.com/es-mx"
      },
      {
        title: "Web oficial AERZEN - Delta Hybrid",
        model: "Delta Hybrid",
        content:
          "La web oficial de AERZEN describe Delta Hybrid como una soplante de tornillo que combina ventajas de soplante y compresor en un mismo sistema. Destaca ahorros energéticos frente a soplantes lobulares convencionales, funcionamiento exento de aceite para aire y un rango amplio de aplicaciones de baja presión.",
        sourceUrl: "https://www.aerzen.com/us/products/screw-blowers"
      },
      {
        title: "Web oficial AERZEN - Delta Blower GM 3S...50L",
        model: "Delta Blower",
        content:
          "La web oficial de AERZEN presenta la unidad compacta Delta Blower GM 3S...50L para biogás. Resalta fiabilidad y eficiencia, caudales volumétricos de 60 a 12.000 metros cúbicos por hora, presión diferencial de -500 a 1.000 mbar y transporte exento de aceite para biogás, gas residual y gases nobles.",
        sourceUrl: "https://www.aerzen.com/es/producto/unidad-compacta-para-biogas-delta-blower-gm-3s-50-l"
      }
    ]
  });

  try {
    const importedManuals = await importAvailableManuals();
    if (importedManuals.length > 0) {
      console.log(`Manuales oficiales importados en seed: ${importedManuals.map((item) => item.model).join(", ")}`);
    }
  } catch (error) {
    console.warn(
      "No se pudieron importar los PDF de manuales locales (los datos de demostración ya están cargados):",
      error instanceof Error ? error.message : error
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
