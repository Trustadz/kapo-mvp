import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/lib/clipboard';

/**
 * Clipboard behaviour on secure vs insecure origins.
 *
 * Kapo is commonly opened over plain HTTP on a LAN/VM address, where
 * `navigator.clipboard` is unavailable; the fallback must still copy (or report
 * failure) instead of silently doing nothing.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubLegacyDocument(execResult: boolean) {
  const area = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const execCommand = vi.fn(() => execResult);
  const appendChild = vi.fn();
  const removeChild = vi.fn();
  vi.stubGlobal('document', {
    createElement: vi.fn(() => area),
    body: { appendChild, removeChild },
    execCommand,
  });
  return { area, execCommand, appendChild, removeChild };
}

describe('copyText', () => {
  it('uses the async clipboard API in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('kapo_mcp_token')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('kapo_mcp_token');
  });

  it('reports failure when the secure API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('token')).resolves.toBe(false);
  });

  it('falls back to a hidden textarea on an insecure origin', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    const { area, execCommand, appendChild, removeChild } = stubLegacyDocument(true);

    await expect(copyText('kapo_mcp_token')).resolves.toBe(true);
    expect(area.value).toBe('kapo_mcp_token');
    expect(area.select).toHaveBeenCalled();
    expect(area.setSelectionRange).toHaveBeenCalledWith(0, 'kapo_mcp_token'.length);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(appendChild).toHaveBeenCalledWith(area);
    expect(removeChild).toHaveBeenCalledWith(area);
  });

  it('reports failure when the legacy copy is refused', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    stubLegacyDocument(false);

    await expect(copyText('token')).resolves.toBe(false);
  });

  it('returns false when there is no document (server render)', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    await expect(copyText('token')).resolves.toBe(false);
  });
});
