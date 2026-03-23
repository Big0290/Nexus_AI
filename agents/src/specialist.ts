import { GoogleGenerativeAI } from '@google/generative-ai';
import type { SpecialistExecutor, SpecialistInvokeInput, SpecialistInvokeResult } from '@nexus/brain-core';

export function createSpecialistExecutor(
  apiKey: string | undefined,
  modelName: string
): SpecialistExecutor {
  if (!apiKey?.trim()) {
    return {
      async execute(input: SpecialistInvokeInput): Promise<SpecialistInvokeResult> {
        const short = input.userPayload.length > 400 ? `${input.userPayload.slice(0, 400)}…` : input.userPayload;
        return {
          raw: `Mock specialist result (set GEMINI_API_KEY for live Gemini). Payload digest: ${short}`,
          confidence: 0.62
        };
      }
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  return {
    async execute(input: SpecialistInvokeInput): Promise<SpecialistInvokeResult> {
      const prompt = [
        input.systemPrompt,
        '',
        'User payload (may be masked for PII):',
        input.userPayload,
        '',
        `Declared tools: ${input.tools.join(', ')}`,
        'Respond with a concise, actionable result.'
      ].join('\n');

      const res = await model.generateContent(prompt);
      const raw = res.response.text();
      return { raw };
    }
  };
}
