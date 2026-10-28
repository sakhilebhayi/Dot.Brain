// Detectors for values that must never travel in an interaction event. Every detector returns a reason code only;
// no caller ever receives, logs or echoes the matched value.

const EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/;
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{32,}/;
const URL_WITH_QUERY = /[?&][A-Za-z0-9_.%-]+=/;
const URL_SCHEME = /\b[a-z][a-z0-9+.-]*:\/\//i;
const PHONE_INTL = /(?:\+|00)\d[\d\s().-]{7,}\d/;
const PHONE_LOCAL = /\b0\d[\d\s.-]{7,}\d\b/;

const digitRuns = (s) => s.match(/\d(?:[\s.-]?\d){7,}/g) ?? [];

export function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// South African ID: YYMMDD SSSS C A Z, valid date and Luhn check.
export function looksLikeSaId(digits) {
  if (!/^\d{13}$/.test(digits)) return false;
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  return luhn(digits);
}

export function looksLikeCard(digits) {
  return /^\d{13,19}$/.test(digits) && luhn(digits);
}

/** @returns {string|null} a reason code, or null when the string carries nothing forbidden. */
export function forbiddenReason(value) {
  if (typeof value !== 'string') return null;
  if (EMAIL.test(value)) return 'forbidden_email';
  if (JWT.test(value)) return 'forbidden_token';
  if (URL_SCHEME.test(value) || URL_WITH_QUERY.test(value)) return 'forbidden_url_or_query';
  for (const run of digitRuns(value)) {
    const digits = run.replace(/\D/g, '');
    if (looksLikeSaId(digits)) return 'forbidden_national_id';
    if (looksLikeCard(digits)) return 'forbidden_card_number';
  }
  if (PHONE_INTL.test(value) || PHONE_LOCAL.test(value)) return 'forbidden_phone';
  if (LONG_TOKEN.test(value)) return 'forbidden_token';
  return null;
}
