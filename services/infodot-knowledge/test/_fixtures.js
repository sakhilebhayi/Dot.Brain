// Shared test data. Lives in test/ so it is not shipped; node --test runs it as an empty file.
export const NOW = new Date('2026-10-23T12:00:00Z');
export const DAY = 86_400_000;

export const daysAgo = (days, from = NOW) => new Date(from.getTime() - days * DAY).toISOString();

/** A contribution that should be recommended: accepted by a non-author 74 days ago. */
export function item(overrides = {}) {
  return {
    contribution_ref: 'ctr_abc123',
    kind: 'solution',
    topics: ['haul-roads'],
    url: 'https://infodot.co.za/solutions/42',
    author_uuid: '7d0c9f6e-0000-4000-8000-000000000001',
    created_at: '2026-08-01T08:00:00Z',
    edited_at: null,
    accepted_by_independent: true,
    accepted_at: '2026-08-10T08:00:00Z',
    verified_by_independent: false,
    verified_at: null,
    helpful_count: 0,
    reuse_count: 0,
    hidden: false,
    reversed: false,
    ...overrides,
  };
}

export const SECRET = 'knowledge-secret-for-tests-xyz';
export const TOKEN = 'memory-token-for-tests-abc';

export const CFG = {
  infodotUrl: 'https://infodot.test',
  secret: SECRET,
  memoryUrl: 'https://memory.test',
  memoryToken: TOKEN,
};

export const ENV = {
  INFODOT_URL: 'https://infodot.test',
  KNOWLEDGE_SECRET_BRAIN: SECRET,
  DOT_MEMORY_URL: 'https://memory.test',
  DOT_MEMORY_TOKEN: TOKEN,
};

export const reply = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

export const noSleep = async () => {};
