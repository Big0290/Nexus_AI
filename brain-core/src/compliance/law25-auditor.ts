import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ComplianceAuditEntry } from '../lib/types.js';
import { newId } from '../util/id.js';

export interface ScanAndMaskResult {
  text: string;
  hadPii: boolean;
  categories: string[];
  redactions: number;
}

type PatternDef = { name: string; re: RegExp; mask: (m: string) => string };

const PATTERNS: PatternDef[] = [
  {
    name: 'email',
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    mask: () => '[EMAIL_REDACTED]'
  },
  {
    name: 'phone',
    re: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
    mask: () => '[PHONE_REDACTED]'
  },
  {
    name: 'sin_ca',
    re: /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g,
    mask: () => '[ID_REDACTED]'
  },
  {
    name: 'credit_card',
    re: /\b(?:\d[ -]*?){13,16}\b/g,
    mask: () => '[PAN_REDACTED]'
  },
  {
    name: 'ipv4',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}\b/g,
    mask: () => '[IP_REDACTED]'
  }
];

/**
 * Law 25–style PII handling: detect, mask specialist/brain traffic, append audit rows.
 */
export class Law25Auditor {
  private auditLog: ComplianceAuditEntry[] = [];
  private readonly maxEntries: number;
  private readonly persistPath?: string;

  constructor(opts: { maxEntries?: number; persistPath?: string } = {}) {
    this.maxEntries = opts.maxEntries ?? 5000;
    this.persistPath = opts.persistPath;
  }

  async loadFromDisk(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const raw = await readFile(this.persistPath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const parsed = lines
        .map((l) => {
          try {
            return JSON.parse(l) as ComplianceAuditEntry;
          } catch {
            return null;
          }
        })
        .filter((x): x is ComplianceAuditEntry => x !== null);
      this.auditLog = parsed.slice(-this.maxEntries).reverse();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw e;
    }
  }

  private async appendDisk(entry: ComplianceAuditEntry): Promise<void> {
    if (!this.persistPath) return;
    await mkdir(dirname(this.persistPath), { recursive: true });
    await appendFile(this.persistPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  scanAndMask(text: string): ScanAndMaskResult {
    let out = text;
    const categories = new Set<string>();
    let redactions = 0;

    for (const p of PATTERNS) {
      out = out.replace(p.re, (match) => {
        categories.add(p.name);
        redactions += 1;
        return p.mask(match);
      });
    }

    return {
      text: out,
      hadPii: redactions > 0,
      categories: [...categories],
      redactions
    };
  }

  record(
    direction: ComplianceAuditEntry['direction'],
    _beforeLength: number,
    scan: ScanAndMaskResult
  ): ComplianceAuditEntry {
    const entry: ComplianceAuditEntry = {
      id: newId('audit'),
      timestamp: new Date().toISOString(),
      direction,
      piiDetected: scan.hadPii,
      categories: scan.categories,
      maskedExcerpt: scan.text.slice(0, 400),
      redactionCount: scan.redactions
    };
    this.auditLog.unshift(entry);
    if (this.auditLog.length > this.maxEntries) {
      this.auditLog.length = this.maxEntries;
    }
    void this.appendDisk(entry);
    return entry;
  }

  /** Middleware-style: mask + audit without storing raw payload */
  auditPayload(direction: ComplianceAuditEntry['direction'], raw: string): { masked: string; entry: ComplianceAuditEntry } {
    const scan = this.scanAndMask(raw);
    const entry = this.record(direction, raw.length, scan);
    return { masked: scan.text, entry };
  }

  listAudit(limit: number): ComplianceAuditEntry[] {
    return this.auditLog.slice(0, limit);
  }
}
