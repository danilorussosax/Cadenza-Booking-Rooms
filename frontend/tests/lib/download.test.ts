import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveBlob } from '@/lib/download';

describe('lib/download · saveBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crea un anchor con download, lo clicca, lo rimuove e revoca l'URL", () => {
    const create = vi.fn(() => 'blob:fake');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let clicked: HTMLAnchorElement | null = null;
    let attachedAtClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = this;
      attachedAtClick = document.body.contains(this);
    });
    const blob = new Blob(['x']);
    saveBlob(blob, 'file.csv');
    const a = clicked as HTMLAnchorElement | null;
    expect(create).toHaveBeenCalledWith(blob);
    expect(a?.download).toBe('file.csv');
    expect(a?.getAttribute('href')).toBe('blob:fake');
    expect(attachedAtClick).toBe(true);
    expect(document.body.contains(a)).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});
