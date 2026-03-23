import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

interface ManifestShape {
  createdAt?: string;
}

/**
 * Remove upload directories older than ttlDays (based on manifest.createdAt, else directory mtime).
 * @returns number of directories removed
 */
export async function cleanupExpiredUploads(dataDir: string, ttlDays: number): Promise<number> {
  if (ttlDays <= 0) return 0;
  const uploadsDir = join(dataDir, 'uploads');
  let removed = 0;
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

  let names: string[];
  try {
    names = await readdir(uploadsDir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 0;
    throw e;
  }

  for (const name of names) {
    const dir = join(uploadsDir, name);
    let createdMs: number | null = null;
    try {
      const manifestRaw = await readFile(join(dir, 'manifest.json'), 'utf8');
      const m = JSON.parse(manifestRaw) as ManifestShape;
      if (m.createdAt) {
        const t = Date.parse(m.createdAt);
        if (!Number.isNaN(t)) createdMs = t;
      }
    } catch {
      // ignore
    }
    if (createdMs == null) {
      try {
        const s = await stat(dir);
        createdMs = s.mtimeMs;
      } catch {
        continue;
      }
    }
    if (createdMs < cutoff) {
      try {
        await rm(dir, { recursive: true, force: true });
        removed += 1;
      } catch {
        // ignore per-dir failures
      }
    }
  }

  return removed;
}

export function scheduleUploadCleanup(
  dataDir: string,
  ttlDays: number,
  intervalMs: number,
  onRun?: (removed: number) => void
): () => void {
  if (ttlDays <= 0) return () => {};

  let timer: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    void cleanupExpiredUploads(dataDir, ttlDays).then((removed) => onRun?.(removed));
  };
  run();
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return () => {
    if (timer) clearInterval(timer);
  };
}
