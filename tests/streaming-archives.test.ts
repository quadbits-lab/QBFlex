import { expect, test } from 'bun:test';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptArchive, decryptArchive } from '../packages/database/src/archive';

test('v2 streamed archives authenticate header/ciphertext, checksum and limits before publication', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-archive-')),
    key = randomBytes(32);
  try {
    const source = join(directory, 'source'),
      archive = join(directory, 'archive'),
      restored = join(directory, 'restored');
    const bytes = randomBytes(3 * 1048576 + 1);
    writeFileSync(source, bytes);
    const manifest = await encryptArchive(source, archive, key);
    expect(manifest.checksum).toBe('sha256:' + createHash('sha256').update(bytes).digest('hex'));
    expect((await decryptArchive(archive, restored, key, manifest.checksum)).format).toBe(2);
    expect(readFileSync(restored)).toEqual(bytes);
    rmSync(restored);
    await expect(
      decryptArchive(archive, restored, randomBytes(32), manifest.checksum),
    ).rejects.toMatchObject({ code: 'BACKUP_CORRUPT' });
    expect(existsSync(restored)).toBe(false);
    await expect(
      decryptArchive(archive, restored, key, 'sha256:' + '0'.repeat(64)),
    ).rejects.toThrow();
    await expect(
      decryptArchive(archive, restored, key, manifest.checksum, { maxBytes: 10 }),
    ).rejects.toThrow();
    const corrupt = readFileSync(archive);
    corrupt[20]! ^= 1;
    writeFileSync(archive, corrupt);
    await expect(decryptArchive(archive, restored, key, manifest.checksum)).rejects.toThrow();
    expect(existsSync(restored)).toBe(false);
    expect(readdirSync(directory).some((name) => name.includes('.partial-'))).toBe(false);
    const abort = new AbortController();
    abort.abort();
    await expect(
      encryptArchive(source, join(directory, 'cancelled'), key, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(existsSync(join(directory, 'cancelled'))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy iv/cipher/tag and base64-text checksums remain readable across chunk boundaries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qb-archive-legacy-')),
    key = randomBytes(32);
  try {
    for (const size of [0, 1, 2, 65535, 65536, 65537, 200001]) {
      const bytes = randomBytes(size),
        iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const archive = join(directory, 'legacy-' + size),
        target = join(directory, 'restore-' + size);
      writeFileSync(
        archive,
        Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]),
      );
      const checksum = createHash('sha256').update(bytes.toString('base64')).digest('hex');
      expect((await decryptArchive(archive, target, key, checksum)).format).toBe(1);
      expect(readFileSync(target)).toEqual(bytes);
    }
    const empty = join(directory, 'empty');
    writeFileSync(empty, new Uint8Array());
    const archive = join(directory, 'empty-v2');
    const manifest = await encryptArchive(empty, archive, key);
    expect(
      (await decryptArchive(archive, join(directory, 'empty-out'), key, manifest.checksum)).size,
    ).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
