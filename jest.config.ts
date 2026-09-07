export default {
  // npm pretest checks all types once. Jest then transpiles each module without
  // rebuilding separate type identities for Axios and the generated API client.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transformIgnorePatterns: ['node_modules/(?!@mairie360/project-api-openapi/)'],
};
