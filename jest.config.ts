export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transformIgnorePatterns: ['node_modules/(?!@mairie360/project-api-openapi/)'],
  testPathIgnorePatterns: ['<rootDir>/tests/projects.*'],
};
