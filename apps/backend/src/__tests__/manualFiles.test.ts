import { describe, expect, it } from "vitest";
import { resolveServableManualFile } from "../utils/manualFiles.js";

const manualsDir = "/srv/manuals";

describe("manual file path containment", () => {
  it("resuelve un nombre de fichero dentro de la carpeta permitida", () => {
    expect(resolveServableManualFile("manual-delta-blower.pdf", manualsDir)).toBe(
      "/srv/manuals/manual-delta-blower.pdf"
    );
  });

  it("acepta una ruta absoluta que siga estando dentro de la carpeta permitida", () => {
    expect(resolveServableManualFile("/srv/manuals/sub/manual.pdf", manualsDir)).toBe("/srv/manuals/sub/manual.pdf");
  });

  it("rechaza rutas que se salen de la carpeta permitida", () => {
    expect(resolveServableManualFile("/etc/passwd", manualsDir)).toBeNull();
    expect(resolveServableManualFile("../../etc/passwd", manualsDir)).toBeNull();
    expect(resolveServableManualFile("/srv/manuals-otros/manual.pdf", manualsDir)).toBeNull();
  });

  it("normaliza los intentos de travesía antes de comprobar", () => {
    expect(resolveServableManualFile("sub/../manual.pdf", manualsDir)).toBe("/srv/manuals/manual.pdf");
  });
});
