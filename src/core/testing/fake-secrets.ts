/**
 * Key-shaped strings for tests, assembled at runtime so the source files
 * never contain anything the leak check would flag.
 */
export const FAKE_KEYS = {
  openAi: ['sk', 'proj', 'T3stOnlyN0tAR3alK3y0000000'].join('-'),
  anthropic: ['sk', 'ant', 'api03', 'T3stOnlyN0tAR3alK3y00000000000'].join('-'),
  google: 'AI' + 'za' + 'SyT3stOnlyN0tAR3alK3y000000000000000',
  github: 'gh' + 'p_' + 'T3stOnlyN0tAR3alK3y0000000000000000000'.slice(0, 36),
  slack: 'xo' + 'xb-' + '000000000000-T3stOnlyN0tReal',
  aws: 'AK' + 'IA' + 'T3STONLYN0TREAL0',
};
