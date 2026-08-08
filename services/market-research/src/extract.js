function buildPendingRow({ text, source, topic, market, relatedPlatform }) {
  const now = new Date().toISOString();
  return [{
    source,
    date: now,
    topic,
    market,
    tier: 'observation',
    finding: text,
    confidence: 0.2,
    supporting_evidence: [],
    related_dot_platform: relatedPlatform,
    recommended_action: null,
    expiry_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    fetched_at: now,
    status: 'pending_extraction',
  }];
}

const EXTRACTION_PROMPT = `You are extracting structured research findings from raw web content.
For each distinct, falsifiable finding in the text, output one JSON object with these fields:
- tier: one of "fact", "observation", "insight", "hypothesis", "recommendation"
- finding: one falsifiable statement
- confidence: 0.00-1.00, calibrated to the tier (facts from primary sources can be high; hypotheses should rarely exceed 0.5)
- supporting_evidence: array of short supporting quotes/data points from the text

Return a JSON array of these objects, nothing else. If the text contains no extractable findings, return an empty array.`;

export async function extractFindings({ text, source, topic, market, relatedPlatform }, { apiKey }) {
  if (!apiKey) {
    return buildPendingRow({ text, source, topic, market, relatedPlatform });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\nText:\n${text.slice(0, 8000)}` }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API extraction failed: HTTP ${response.status}`);
  }

  const body = await response.json();
  const rawText = body.content?.[0]?.text ?? '[]';
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // The model didn't return clean JSON -- fail to a pending row rather
    // than guessing at malformed structure.
    return buildPendingRow({ text, source, topic, market, relatedPlatform });
  }

  const now = new Date().toISOString();
  return parsed.map((item) => ({
    source,
    date: now,
    topic,
    market,
    tier: item.tier,
    finding: item.finding,
    confidence: item.confidence,
    supporting_evidence: item.supporting_evidence ?? [],
    related_dot_platform: relatedPlatform,
    recommended_action: item.tier === 'recommendation' ? item.finding : null,
    expiry_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    fetched_at: now,
    status: 'structured',
  }));
}
