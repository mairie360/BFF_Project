import config from '../jest.config';

// MAIR-241: the thresholds stood at 60 % while the real coverage is above 77 %, then 83 % once the helpers' fallback branches were tested, so a regression did not fail the
// CI. They must not go back under the floor below (raise the floor with the thresholds, never lower them).
describe('MAIR-241 coverage thresholds', () => {
  const global = config.coverageThreshold?.global;

  it.each([
    ['statements', 80],
    ['functions', 80],
    ['lines', 80],
    ['branches', 80],
  ] as const)('keeps the %s threshold at %i or more', (metric, floor) => {
    expect(global?.[metric]).toBeGreaterThanOrEqual(floor);
  });

  it('measures the coverage on every run', () => {
    expect(config.collectCoverage).toBe(true);
  });
});
