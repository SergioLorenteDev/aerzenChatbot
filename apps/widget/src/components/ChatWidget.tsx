import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactElement } from "react";
import type { WidgetOptions } from "../types/widget";
import { useChatWidget } from "../hooks/useChatWidget";
import { tokenizeMessage } from "../utils/linkify";
import aerzenLogoUrl from "../assets/aerzen-logo.png";
import "../styles/widget.css";

function renderMessageContent(content: string) {
  return tokenizeMessage(content).map<ReactElement>((token, index) =>
    token.type === "link" ? (
      <a key={`link-${index}-${token.href}`} href={token.href} target="_blank" rel="noreferrer">
        {token.label}
      </a>
    ) : (
      <span key={`text-${index}`}>{token.value}</span>
    )
  );
}

export function ChatWidget(options: WidgetOptions) {
  const { state, toggle, close, submitMessage } = useChatWidget(options);
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const uid = useId();
  const panelId = `aerzen-chat-panel-${uid}`;
  const inputId = `aerzen-chat-input-${uid}`;
  const showRating = state.currentState === "collect_rating";
  const embedded = options.embedded === true;
  const canSend = Boolean(state.sessionId) && !state.loading;

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth"
    });
  }, [state.messages, state.loading]);

  // Al abrir, el foco entra en el panel; al cerrar, vuelve al botón que lo abrió.
  useEffect(() => {
    if (state.isOpen && !wasOpenRef.current) {
      panelRef.current?.focus();
    } else if (!state.isOpen && wasOpenRef.current) {
      launcherRef.current?.focus();
    }

    wasOpenRef.current = state.isOpen;
  }, [state.isOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !canSend) {
      return;
    }
    void submitMessage(message);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!draft.trim() || !canSend) {
        return;
      }
      const message = draft.trim();
      void submitMessage(message);
      setDraft("");
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }

  function handleRatingSelect(rating: number) {
    if (!canSend) {
      return;
    }
    void submitMessage(String(rating));
  }

  return (
    <div className={`aerzen-widget-shell ${state.isOpen ? "is-open" : ""} ${embedded ? "is-embedded" : ""}`}>
      <button
        className="aerzen-widget-launcher"
        onClick={toggle}
        type="button"
        ref={launcherRef}
        aria-expanded={state.isOpen}
        aria-controls={panelId}
      >
        <img className="launcher-mark" src={aerzenLogoUrl} alt="" aria-hidden="true" />
        <span className="launcher-copy">
          <span>{state.isOpen ? "Cerrar chat" : "Chatbot Aerzen"}</span>
          <small>{state.isOpen ? "Volver a la página" : "Asistencia técnica"}</small>
        </span>
      </button>

      {state.isOpen ? (
        <section
          className="aerzen-widget-panel"
          id={panelId}
          aria-label="Chat de postventa"
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
        >
          <header className="aerzen-widget-header">
            <div className="brand-lockup">
              <img className="brand-emblem" src={aerzenLogoUrl} alt="AERZEN" />
              <div>
                <p className="eyebrow">AERZEN Iberica</p>
                <p className="widget-title">{options.title ?? "Asistente de postventa"}</p>
              </div>
            </div>
            <p className="status-dot">
              <span aria-hidden="true" />
              {state.loading ? "Procesando" : "En línea"}
            </p>
          </header>

          <div
            className="aerzen-widget-messages"
            ref={messagesRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Conversación"
          >
            {state.messages.map((message) => (
              <article key={message.id} className={`message-bubble ${message.role}`}>
                <p>{renderMessageContent(message.content)}</p>
              </article>
            ))}
            {state.loading ? (
              <article className="message-bubble assistant is-typing">
                <p>
                  <span />
                  <span />
                  <span />
                </p>
              </article>
            ) : null}
          </div>

          <form className="aerzen-widget-form" onSubmit={handleSubmit}>
            {showRating ? (
              <div className="rating-panel" aria-label="Valoración de la atención">
                <span className="rating-label">Valore la atención:</span>
                <div className="rating-stars">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      className="rating-star"
                      type="button"
                      onClick={() => handleRatingSelect(rating)}
                      disabled={!canSend}
                      aria-label={`${rating} estrella${rating > 1 ? "s" : ""}`}
                    >
                      {"★".repeat(rating)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="sr-only" htmlFor={inputId}>
              Escriba su mensaje
            </label>
            <textarea
              id={inputId}
              rows={3}
              placeholder={state.sessionId ? "Escriba su respuesta..." : "Iniciando conversación..."}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!canSend}
            />
            <button type="submit" disabled={!canSend || !draft.trim()}>
              Enviar
            </button>
            <p className="input-hint">Enter para enviar · Shift + Enter para salto de línea</p>
          </form>
        </section>
      ) : null}
    </div>
  );
}
