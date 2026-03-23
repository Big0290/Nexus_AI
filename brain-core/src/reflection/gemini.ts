import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TextCompletionModel } from '../lib/types.js';

export function createGenAI(apiKey: string | undefined): GoogleGenerativeAI | null {
  if (!apiKey?.trim()) return null;
  return new GoogleGenerativeAI(apiKey);
}

export function wrapTextModel(genAI: GoogleGenerativeAI, modelName: string): TextCompletionModel {
  const model = genAI.getGenerativeModel({ model: modelName });
  return {
    async generateContent(prompt: string) {
      return model.generateContent(prompt);
    }
  };
}

/** Same surface as {@link wrapTextModel} with bounded retries for transient API errors */
export function wrapTextModelWithRetry(
  genAI: GoogleGenerativeAI,
  modelName: string,
  opts?: { retries?: number; baseDelayMs?: number }
): TextCompletionModel {
  const inner = wrapTextModel(genAI, modelName);
  const retries = opts?.retries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 400;

  return {
    async generateContent(prompt: string) {
      let last: Error | undefined;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await inner.generateContent(prompt);
        } catch (e) {
          last = e instanceof Error ? e : new Error(String(e));
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
          }
        }
      }
      throw last ?? new Error('Gemini generateContent failed after retries');
    }
  };
}

export async function embedTextGemini(
  genAI: GoogleGenerativeAI,
  modelName: string,
  text: string
): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: modelName });
  const res = await model.embedContent(text);
  const vals = res.embedding?.values;
  if (!vals?.length) throw new Error('Embedding returned empty values');
  return vals;
}
