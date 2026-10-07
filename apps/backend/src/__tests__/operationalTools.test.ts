import { describe, expect, it, vi } from "vitest";

vi.mock("../db/prisma", () => ({
  prisma: {
    machine: {
      findFirst: vi.fn(async ({ where }: { where: { OR: Array<{ serialNumber?: string; fabricationCode?: string }> } }) => {
        const serialCandidate = where.OR[0]?.serialNumber ?? where.OR[1]?.fabricationCode;
        if (serialCandidate === "GM35-ES-0001") {
          return {
            id: "machine-1",
            model: "GM 35",
            serialNumber: "GM35-ES-0001",
            fabricationCode: "FAB-GM35-0001",
            warrantyEnd: new Date("2027-03-15"),
            region: { id: "region-1", name: "Andalucia, Extremadura y Canarias" },
            assignedWorkerId: "worker-1",
            assignedWorker: { id: "worker-1", name: "Ana Ferrer", email: "ana.ferrer@example.com" }
          };
        }
        return null;
      })
    },
    region: {
      findUnique: vi.fn(async ({ where }: { where: { name?: string; id?: string } }) => ({
        id: where.id ?? "region-1",
        name: where.name ?? "Andalucia, Extremadura y Canarias",
        workers: [{ id: "worker-1", name: "Ana Ferrer", email: "ana.ferrer@example.com" }]
      }))
    },
    manual: {
      findUnique: vi.fn(async ({ where }: { where: { model: string } }) => ({
        id: "manual-1",
        model: where.model,
        title: `Manual ${where.model}`,
        fileUrl: "https://docs.example.com/manual.pdf"
      }))
    },
    incident: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "incident-1",
        reference: data.reference,
        serialNumber: data.serialNumber,
        locality: data.locality,
        issueSummary: data.issueSummary
      }))
    }
  }
}));

import {
  checkSerialNumber,
  createIncident,
  getManualForModel,
  getRegionByCustomerOrSerial,
  getWarrantyStatus
} from "../tools/operationalTools.js";

describe("operational tools", () => {
  it("validates an existing serial from structured data", async () => {
    const result = await checkSerialNumber("GM35-ES-0001");
    expect(result.exists).toBe(true);
    expect(result.machineRecord?.model).toBe("GM 35");
  });

  it("resolves warranty state deterministically", async () => {
    const result = await getWarrantyStatus("GM35-ES-0001");
    expect(result.status).toBe("in_warranty");
  });

  it("resolves region and worker from the machine record", async () => {
    const result = await getRegionByCustomerOrSerial({ serialNumber: "GM35-ES-0001" });
    expect(result.region?.name).toContain("Andalucia");
    expect(result.worker?.name).toBe("Ana Ferrer");
  });

  it("creates a mock incident", async () => {
    const result = await createIncident({
      sessionId: "session-1",
      serialNumber: "GM35-ES-0001",
      locality: "Sevilla",
      model: "GM 35",
      region: { name: "Andalucia, Extremadura y Canarias" },
      assignedWorkerId: "worker-1",
      issueSummary: "El equipo muestra alarma de temperatura"
    });
    expect(result.incident.reference).toMatch(/^INC-/);
    expect(result.incident.serialNumber).toBe("GM35-ES-0001");
    expect(result.incident.locality).toBe("Sevilla");
  });

  it("stores fallback values when the serial is not provided", async () => {
    const result = await createIncident({
      sessionId: "session-2",
      model: "Delta Hybrid",
      region: { name: "Centro y Castilla La Mancha" },
      issueSummary: "El equipo no arranca"
    });

    expect(result.incident.serialNumber).toBe("(no aportado)");
    expect(result.incident.locality).toBe("(no aportada)");
  });

  it("finds the manual by model", async () => {
    const result = await getManualForModel({ model: "GM 35" });
    expect(result.manual?.title).toContain("GM 35");
  });
});
