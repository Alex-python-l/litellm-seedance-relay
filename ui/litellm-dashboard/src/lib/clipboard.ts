export type CopyStatus = "idle" | "copied" | "failed";

export async function copyText(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Some browsers expose the Clipboard API but block it by policy.
    }
  }

  const textarea = document.createElement("textarea");
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    activeElement?.focus();
  }
}

export async function copyTextStatus(text: string): Promise<CopyStatus> {
  return (await copyText(text)) ? "copied" : "failed";
}

export function copyButtonLabel(status: CopyStatus, idleLabel: string): string {
  if (status === "copied") {
    return "已复制";
  }
  if (status === "failed") {
    return "复制失败";
  }
  return idleLabel;
}
