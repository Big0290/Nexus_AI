import { GoogleGenerativeAI } from '@google/generative-ai';

const VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.0-flash';

/**
 * Optional Gemini vision path for images or PDFs with no extractable text.
 * Returns plain-language description for downstream masking + specialist.
 */
export async function describeWithGeminiVision(
  apiKey: string | undefined,
  mimeType: string,
  buffer: Buffer,
  hint: string
): Promise<string | null> {
  if (!apiKey?.trim()) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: VISION_MODEL });
  const base64 = buffer.toString('base64');

  const prompt = `${hint}

Describe the content factually for a knowledge-base entry: main subjects, any visible text (transcribe short snippets), tables or charts at a high level, and uncertainties. Do not invent details.`;

  try {
    const res = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: mimeType.split(';')[0].trim() || 'application/octet-stream',
          data: base64
        }
      }
    ]);
    const text = res.response.text();
    return text?.trim() || null;
  } catch {
    return null;
  }
}
