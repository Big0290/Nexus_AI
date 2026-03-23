/**
 * Turn raw Brain / Gemini error strings into a short UI summary plus full detail for modals.
 */
export function summarizeBrainError(raw: string): {
  title: string;
  hint: string;
  detail: string;
} {
  const detail = raw.trim();
  if (!detail) {
    return { title: 'Error', hint: 'Something went wrong (no message).', detail: raw };
  }

  const lower = detail.toLowerCase();

  if (lower.includes('429') || lower.includes('too many requests') || lower.includes('quota exceeded')) {
    return {
      title: 'Gemini API quota or rate limit',
      hint: 'Google blocked this request: free-tier limits, per-minute caps, or no quota left for this model. Wait and retry, try another GEMINI_MODEL in .env, or enable billing in Google AI Studio.',
      detail
    };
  }

  if (lower.includes('resource exhausted') || lower.includes('rate limit')) {
    return {
      title: 'Gemini rate limit',
      hint: 'Too many requests or tokens in a short window. Retry after a short wait or reduce prompt size.',
      detail
    };
  }

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('api key')) {
    return {
      title: 'API key problem',
      hint: 'Check GEMINI_API_KEY in .env and restart the server. If you use NEXUS_API_KEY, add the same key in the Brain tab.',
      detail
    };
  }

  if (lower.includes('403') || lower.includes('permission')) {
    return {
      title: 'Permission denied',
      hint: 'This API key may not have access to the chosen model or project.',
      detail
    };
  }

  if (
    lower.includes('404') ||
    lower.includes('no longer available') ||
    lower.includes('not available to new users')
  ) {
    return {
      title: 'Gemini model unavailable',
      hint: 'This model id is retired or not enabled for your account. Set GEMINI_MODEL in .env to a current model (e.g. gemini-2.5-flash) and restart the server.',
      detail
    };
  }

  if (lower.includes('fetch') && lower.includes('failed')) {
    return {
      title: 'Network error',
      hint: 'Could not reach Google’s API. Check your connection, firewall, or VPN.',
      detail
    };
  }

  const firstLine = detail.split('\n')[0];
  const short =
    firstLine.length > 140 ? `${firstLine.slice(0, 140)}…` : firstLine;
  return {
    title: 'Brain run failed',
    hint: short,
    detail
  };
}
