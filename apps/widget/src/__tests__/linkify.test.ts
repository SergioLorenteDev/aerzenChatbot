import { describe, expect, it } from "vitest";
import { tokenizeMessage } from "../utils/linkify";

describe("tokenizeMessage", () => {
  it("convierte un enlace markdown en un token de enlace", () => {
    const tokens = tokenizeMessage("He localizado el manual: [Manual GM 35](https://docs.example.com/gm35.pdf). ¿Lo quiere?");

    expect(tokens).toEqual([
      { type: "text", value: "He localizado el manual: " },
      { type: "link", label: "Manual GM 35", href: "https://docs.example.com/gm35.pdf" },
      { type: "text", value: ". ¿Lo quiere?" }
    ]);
  });

  it("enlaza URLs sueltas y conserva la puntuación final como texto", () => {
    const tokens = tokenizeMessage("Puede consultarlo en https://docs.example.com/gm35.pdf, gracias.");

    expect(tokens).toEqual([
      { type: "text", value: "Puede consultarlo en " },
      { type: "link", label: "https://docs.example.com/gm35.pdf", href: "https://docs.example.com/gm35.pdf" },
      { type: "text", value: ", gracias." }
    ]);
  });

  it("mantiene el texto plano cuando no hay enlaces", () => {
    expect(tokenizeMessage("El equipo figura en periodo de garantía.")).toEqual([
      { type: "text", value: "El equipo figura en periodo de garantía." }
    ]);
  });

  it("no genera enlaces con esquemas peligrosos", () => {
    const tokens = tokenizeMessage("[pulsa aquí](javascript:alert(1)) y tambien [ftp](ftp://host/f)");

    expect(tokens.every((token) => token.type === "text")).toBe(true);
    expect(tokens).toEqual([{ type: "text", value: "[pulsa aquí](javascript:alert(1)) y tambien [ftp](ftp://host/f)" }]);
  });

  it("gestiona varios enlaces en el mismo mensaje", () => {
    const tokens = tokenizeMessage("[uno](https://a.example.com) y [dos](https://b.example.com)");

    expect(tokens.filter((token) => token.type === "link")).toEqual([
      { type: "link", label: "uno", href: "https://a.example.com" },
      { type: "link", label: "dos", href: "https://b.example.com" }
    ]);
  });

  it("no pierde texto cuando el mensaje empieza por un enlace", () => {
    const tokens = tokenizeMessage("[Manual](https://docs.example.com/m.pdf) disponible.");

    expect(tokens).toEqual([
      { type: "link", label: "Manual", href: "https://docs.example.com/m.pdf" },
      { type: "text", value: " disponible." }
    ]);
  });
});
