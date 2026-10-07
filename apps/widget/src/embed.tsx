import { createRoot, type Root } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import type { WidgetOptions } from "./types/widget";

declare global {
  interface Window {
    AerzenChatbot?: {
      mount: (selector: string, options?: WidgetOptions) => void;
      unmount: (selector: string) => void;
    };
  }
}

const mountedRoots = new WeakMap<Element, Root>();

function resolveTarget(selector: string) {
  const target = document.querySelector(selector);
  if (!target) {
    throw new Error(`No se encontró el contenedor ${selector}`);
  }
  return target;
}

/** Monta el widget. Llamarlo dos veces sobre el mismo contenedor no lo duplica. */
export function mount(selector: string, options: WidgetOptions = {}) {
  const target = resolveTarget(selector);
  const existingRoot = mountedRoots.get(target);

  if (existingRoot) {
    existingRoot.render(<ChatWidget {...options} />);
    return;
  }

  const root = createRoot(target);
  mountedRoots.set(target, root);
  root.render(<ChatWidget {...options} />);
}

/** Desmonta el widget y libera el árbol de React asociado al contenedor. */
export function unmount(selector: string) {
  const target = document.querySelector(selector);
  if (!target) {
    return;
  }

  const root = mountedRoots.get(target);
  if (!root) {
    return;
  }

  root.unmount();
  mountedRoots.delete(target);
}

window.AerzenChatbot = { mount, unmount };
