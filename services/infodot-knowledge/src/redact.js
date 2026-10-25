// services/infodot-knowledge/src/redact.js

/** Replace every occurrence of each secret (and its URL-encoded form) with [redacted]. */
export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue;
    out = out.split(secret).join('[redacted]');
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join('[redacted]');
  }
  return out;
}
