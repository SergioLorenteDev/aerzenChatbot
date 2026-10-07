export type MessageToken =
  | { type: "text"; value: string }
  | { type: "link"; label: string; href: string };

const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function splitBareUrls(content: string): MessageToken[] {
  const tokens: MessageToken[] = [];
  const bareUrl = /(https?:\/\/[^\s]+)/g;

  for (const part of content.split(bareUrl)) {
    if (!part) {
      continue;
    }

    if (/^https?:\/\//.test(part)) {
      const href = part.replace(TRAILING_PUNCTUATION, "");
      const trailing = part.slice(href.length);

      if (href) {
        tokens.push({ type: "link", label: href, href });
      }
      if (trailing) {
        tokens.push({ type: "text", value: trailing });
      }
      continue;
    }

    tokens.push({ type: "text", value: part });
  }

  return tokens;
}

/** Une tokens de texto consecutivos para que la lista sea canónica. */
function mergeAdjacentText(tokens: MessageToken[]): MessageToken[] {
  const merged: MessageToken[] = [];

  for (const token of tokens) {
    const previous = merged.at(-1);

    if (token.type === "text" && previous?.type === "text") {
      merged[merged.length - 1] = { type: "text", value: `${previous.value}${token.value}` };
      continue;
    }

    merged.push(token);
  }

  return merged;
}

/**
 * Convierte el texto del backend en tokens de texto y enlaces.
 *
 * Solo se aceptan enlaces `http`/`https`: cualquier otro esquema (por ejemplo
 * `javascript:`) se trata como texto plano y nunca llega a un `href`.
 */
export function tokenizeMessage(content: string): MessageToken[] {
  const tokens: MessageToken[] = [];
  const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markdownLink.exec(content)) !== null) {
    const [fullMatch, label, href] = match;

    if (match.index > lastIndex) {
      tokens.push(...splitBareUrls(content.slice(lastIndex, match.index)));
    }

    if (label && href) {
      tokens.push({ type: "link", label, href });
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < content.length) {
    tokens.push(...splitBareUrls(content.slice(lastIndex)));
  }

  return mergeAdjacentText(tokens);
}
