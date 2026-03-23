/** Lightweight lexical similarity for recall when embeddings are unavailable */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

export function cosineSimilarityTfIdf(
  query: string,
  doc: string,
  corpusDocs: string[]
): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;

  const df = new Map<string, number>();
  const docsTokens = corpusDocs.map((d) => tokenize(d));
  for (const tokens of docsTokens) {
    const seen = new Set(tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const N = Math.max(1, corpusDocs.length);

  const idf = (term: string): number => {
    const dfi = df.get(term) ?? 0;
    return Math.log((1 + N) / (1 + dfi)) + 1;
  };

  const qTf = termFreq(qTokens);
  const qVec = new Map<string, number>();
  for (const [term, tf] of qTf) {
    qVec.set(term, tf * idf(term));
  }

  const dTokens = tokenize(doc);
  const dTf = termFreq(dTokens);
  const dVec = new Map<string, number>();
  for (const [term, tf] of dTf) {
    dVec.set(term, tf * idf(term));
  }

  let dot = 0;
  let qNorm = 0;
  let dNorm = 0;
  for (const v of qVec.values()) qNorm += v * v;
  for (const v of dVec.values()) dNorm += v * v;
  const keys = new Set([...qVec.keys(), ...dVec.keys()]);
  for (const k of keys) {
    dot += (qVec.get(k) ?? 0) * (dVec.get(k) ?? 0);
  }
  const denom = Math.sqrt(qNorm) * Math.sqrt(dNorm);
  return denom === 0 ? 0 : dot / denom;
}
