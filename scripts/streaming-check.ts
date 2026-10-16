import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stageTransfer } from '../packages/storage/src/transfer';
import { encryptArchive, decryptArchive } from '../packages/database/src/archive';
import {
  encryptControlArchive,
  decryptControlArchive,
} from '../packages/database/src/control-archive';

// Isolated reference measurement, not a provider/device throughput certification.
const directory = mkdtempSync(join(tmpdir(), 'qb-stream-reference-'));
const size = 100 * 1048576,
  chunk = new Uint8Array(65536).fill(42);
let remaining = size,
  peakRss = process.memoryUsage().rss;
const baselineRss = peakRss;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 5);
const timings: Record<string, number> = {};
try {
  let start = performance.now();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (remaining) {
          controller.enqueue(chunk);
          remaining -= chunk.length;
        } else controller.close();
      },
    },
    { highWaterMark: 1 },
  );
  const stage = await stageTransfer(body, directory, size);
  timings.stageMs = performance.now() - start;
  const key = randomBytes(32),
    archive = join(directory, 'reference.enc'),
    target = join(directory, 'restored');
  start = performance.now();
  const manifest = await encryptArchive(stage.path, archive, key);
  timings.encryptMs = performance.now() - start;
  start = performance.now();
  const restore = await decryptArchive(archive, target, key, manifest.checksum);
  timings.restoreMs = performance.now() - start;
  if (restore.size !== size || stage.maxChunkBytes > 65536)
    throw new Error('Streaming reference bounds failed');
  const controlArchive = join(directory, 'control-reference.enc'),
    controlTarget = join(directory, 'control-restored');
  const controlMaster = 'ephemeral-reference-master-' + key.toString('hex');
  start = performance.now();
  await encryptControlArchive(stage.path, controlArchive, controlMaster);
  timings.controlEncryptMs = performance.now() - start;
  start = performance.now();
  const controlRestore = await decryptControlArchive(controlArchive, controlTarget, controlMaster);
  timings.controlRestoreMs = performance.now() - start;
  if (controlRestore.size !== size || controlRestore.format !== 2)
    throw new Error('Control archive streaming reference failed');
  await stage.dispose();
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  console.log(
    JSON.stringify(
      {
        runtime: Bun.version,
        platform: process.platform,
        architecture: process.arch,
        inputBytes: size,
        maximumInputChunkBytes: stage.maxChunkBytes,
        baselineRss,
        peakRss,
        observedRssIncreaseBytes: peakRss - baselineRss,
        timings,
        partialFilesRemaining: readdirSync(directory).filter((name) => name.includes('.partial-'))
          .length,
        caveat:
          'Sampled single-process reference, not a universal memory ceiling or speedup claim.',
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(sampler);
  rmSync(directory, { recursive: true, force: true });
}
