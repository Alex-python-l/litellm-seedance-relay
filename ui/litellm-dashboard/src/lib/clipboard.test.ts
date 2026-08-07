import { afterEach, describe, expect, it, vi } from "vitest";

import { copyButtonLabel, copyText, copyTextStatus } from "./clipboard";

const secureContextDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
}

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (secureContextDescriptor) {
    Object.defineProperty(window, "isSecureContext", secureContextDescriptor);
  } else {
    Reflect.deleteProperty(window, "isSecureContext");
  }
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (execCommandDescriptor) {
    Object.defineProperty(document, "execCommand", execCommandDescriptor);
  } else {
    Reflect.deleteProperty(document, "execCommand");
  }
});

describe("copyText", () => {
  it("uses the Clipboard API in a secure context", async () => {
    const writeText = vi.fn(async () => undefined);
    setSecureContext(true);
    setClipboard(writeText);

    await expect(copyText("activation-link")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("activation-link");
  });

  it("falls back to execCommand when Clipboard API access is denied", async () => {
    setSecureContext(true);
    setClipboard(vi.fn(async () => Promise.reject(new Error("denied"))));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    await expect(copyText("sk-test")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports failure when neither copy mechanism succeeds", async () => {
    setSecureContext(false);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });

    await expect(copyText("sk-test")).resolves.toBe(false);
  });
});

describe("copyButtonLabel", () => {
  it("shows visible copy feedback", () => {
    expect(copyButtonLabel("idle", "复制链接")).toBe("复制链接");
    expect(copyButtonLabel("copied", "复制链接")).toBe("已复制");
    expect(copyButtonLabel("failed", "复制链接")).toBe("复制失败");
  });

  it("converts the copy result into UI state", async () => {
    setSecureContext(false);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => true) });

    await expect(copyTextStatus("sk-test")).resolves.toBe("copied");
  });
});
