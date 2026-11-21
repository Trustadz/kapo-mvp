/**
 * Clipboard helper with a fallback for insecure origins.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS or localhost).
 * Kapo is often opened over plain HTTP on a LAN or VM address, where the async
 * API is unavailable; there the hidden-textarea + `execCommand('copy')` path
 * still works and is only used as a fallback.
 */

export async function copyText(text: string): Promise<boolean> {
  if (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    navigator.clipboard?.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return copyTextLegacy(text);
}

function copyTextLegacy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.width = '1px';
  area.style.height = '1px';
  area.style.padding = '0';
  area.style.border = 'none';
  area.style.opacity = '0';
  document.body.appendChild(area);

  let copied = false;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(area);
  }
  return copied;
}
