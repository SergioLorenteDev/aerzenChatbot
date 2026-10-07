import { isAbsolute, resolve, sep } from "node:path";
import { env } from "../config/env.js";

export const DEFAULT_MANUALS_DIR = "fixtures/content/pdfs";

/** Carpeta raíz desde la que se pueden servir PDF de manuales. */
export function getManualsDir() {
  return resolve(env.MANUALS_DIR?.trim() || DEFAULT_MANUALS_DIR);
}

/**
 * Resuelve la ruta de un manual y comprueba que siga estando dentro de la carpeta
 * permitida.
 *
 * Un registro de la base de datos no debe poder apuntar a un fichero arbitrario del
 * sistema: si la ruta se sale de MANUALS_DIR se devuelve null y la ruta responde 404.
 */
export function resolveServableManualFile(fileUrl: string, manualsDir = getManualsDir()) {
  const root = resolve(manualsDir);
  const candidate = isAbsolute(fileUrl) ? resolve(fileUrl) : resolve(root, fileUrl);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;

  if (candidate !== root && !candidate.startsWith(rootPrefix)) {
    return null;
  }

  return candidate;
}
