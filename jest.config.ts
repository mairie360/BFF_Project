export default {
  // npm pretest checks all types once. Jest then transpiles each module without
  // rebuilding separate type identities for Axios and the generated API client.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      // axios est déclaré deux fois (index.d.ts et index.d.cts) : les clients générés
      // ne sont donc typés qu'au build, pas à nouveau ici.
      diagnostics: { exclude: ['**/node_modules/**', '**/src/clients/*.ts'] },
    }],
  },
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transformIgnorePatterns: ['/node_modules/(?!@mairie360/)'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: {
    global: { branches: 60, functions: 60, lines: 60, statements: 60 },
  },
};
