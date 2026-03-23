import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Law25Auditor } from '@nexus/brain-core';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { describeWithGeminiVision } from './gemini-vision.js';

export interface IngestedFileMeta {
  name: string;
  mime: string;
  sha256: string;
  bytes: number;
  extractedChars: number;
  visionUsed?: boolean;
}

export interface IngestManifest {
  ingestId: string;
  createdAt: string;
  files: IngestedFileMeta[];
  maskedTextChars: number;
}

const TEXT_MIMES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'text/html'
]);

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function extractXlsx(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 20)) {
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' });
    const rows = csv.split('\n').slice(0, 500);
    parts.push(`## Sheet: ${sheetName}\n${rows.join('\n')}`);
  }
  return parts.join('\n\n');
}

async function extractPdf(buf: Buffer): Promise<string> {
  const data = await pdfParse(buf);
  return typeof data.text === 'string' ? data.text : '';
}

export async function extractTextFromFile(
  name: string,
  mimeRaw: string,
  buf: Buffer,
  geminiApiKey?: string
): Promise<{ text: string; visionUsed: boolean }> {
  const mime = mimeRaw.split(';')[0].trim().toLowerCase();
  let text = '';
  let visionUsed = false;

  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    text = await extractPdf(buf).catch(() => '');
    if (text.trim().length < 40 && geminiApiKey?.trim()) {
      const v = await describeWithGeminiVision(
        geminiApiKey,
        'application/pdf',
        buf,
        'This PDF had little or no extractable text (may be scanned).'
      );
      if (v) {
        text = `[Gemini vision description of PDF]\n${v}`;
        visionUsed = true;
      }
    }
    return { text, visionUsed };
  }

  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    name.toLowerCase().endsWith('.xlsx') ||
    name.toLowerCase().endsWith('.xls')
  ) {
    try {
      text = extractXlsx(buf);
    } catch {
      text = '';
    }
    return { text, visionUsed };
  }

  if (mime === 'text/csv' || name.toLowerCase().endsWith('.csv')) {
    return { text: buf.toString('utf8'), visionUsed };
  }

  if (TEXT_MIMES.has(mime) || name.toLowerCase().endsWith('.md') || name.toLowerCase().endsWith('.txt')) {
    return { text: buf.toString('utf8'), visionUsed };
  }

  if (mime.startsWith('image/')) {
    if (geminiApiKey?.trim()) {
      const v = await describeWithGeminiVision(geminiApiKey, mime, buf, 'This is an image uploaded for teaching.');
      if (v) {
        return { text: `[Gemini vision description]\n${v}`, visionUsed: true };
      }
    }
    return { text: `[Binary image ${name} — no vision API key or vision failed; no text extracted.]`, visionUsed };
  }

  return { text: `[Unsupported or empty extract for ${name} (${mime})]`, visionUsed };
}

export async function ingestUploadedFiles(opts: {
  dataDir: string;
  auditor: Law25Auditor;
  files: { name: string; mime: string; buffer: Buffer }[];
  geminiApiKey?: string;
}): Promise<{
  ingestId: string;
  manifest: IngestManifest;
  maskedCombinedText: string;
  sourceFiles: { name: string; mime: string }[];
}> {
  const ingestId = randomUUID();
  const baseDir = join(opts.dataDir, 'uploads', ingestId);
  await mkdir(join(baseDir, 'original'), { recursive: true });

  const fileMetas: IngestedFileMeta[] = [];
  const textBlocks: string[] = [];

  for (const f of opts.files) {
    const safeName = f.name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 180);
    const hash = sha256(f.buffer);
    await writeFile(join(baseDir, 'original', safeName), f.buffer);

    const { text, visionUsed } = await extractTextFromFile(f.name, f.mime, f.buffer, opts.geminiApiKey);
    const block = `### File: ${f.name} (${f.mime})\n${text}`;
    textBlocks.push(block);

    fileMetas.push({
      name: f.name,
      mime: f.mime,
      sha256: hash,
      bytes: f.buffer.length,
      extractedChars: text.length,
      visionUsed
    });
  }

  const combinedRaw = textBlocks.join('\n\n---\n\n');
  const masked = opts.auditor.scanAndMask(combinedRaw);
  opts.auditor.record('specialist_input', combinedRaw.length, masked);

  await writeFile(join(baseDir, 'masked.txt'), masked.text, 'utf8');

  const manifest: IngestManifest = {
    ingestId,
    createdAt: new Date().toISOString(),
    files: fileMetas,
    maskedTextChars: masked.text.length
  };
  await writeFile(join(baseDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const sourceFiles = opts.files.map((f) => ({ name: f.name, mime: f.mime }));

  return {
    ingestId,
    manifest,
    maskedCombinedText: masked.text,
    sourceFiles
  };
}

export async function loadDocumentIngest(
  dataDir: string,
  ingestId: string
): Promise<{
  maskedCombinedText: string;
  sourceFiles: { name: string; mime: string }[];
} | null> {
  const baseDir = join(dataDir, 'uploads', ingestId);
  try {
    const manifestRaw = await readFile(join(baseDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as IngestManifest;
    const maskedCombinedText = await readFile(join(baseDir, 'masked.txt'), 'utf8');
    const sourceFiles = manifest.files.map((f) => ({ name: f.name, mime: f.mime }));
    if (!maskedCombinedText.trim()) return null;
    return { maskedCombinedText, sourceFiles };
  } catch {
    return null;
  }
}
