import { describe, expect, it, vi } from "vitest";
import { createMessageId } from "../utils/ids";

describe("createMessageId", () => {
  it("usa crypto.randomUUID cuando está disponible", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID });

    expect(createMessageId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("genera un identificador alternativo en contextos sin crypto.randomUUID", () => {
    vi.stubGlobal("crypto", undefined);

    const first = createMessageId();
    const second = createMessageId();

    expect(first).toMatch(/^msg-[a-z0-9]+-[a-z0-9]+$/);
    expect(first).not.toBe(second);

    vi.unstubAllGlobals();
  });
});
