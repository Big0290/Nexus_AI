import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load `.env` from the current working directory, then repo root (parent / grandparent).
 * Node does not read `.env` files by default — without this, `GEMINI_API_KEY` in the project root is ignored when
 * `npm run dev` runs with cwd `server/`.
 */
const candidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '.env'),
  resolve(process.cwd(), '..', '..', '.env')
];
for (const path of candidates) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}
