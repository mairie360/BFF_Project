import { assertConfigured } from '@mairie360/bffs-lib';
import { UPSTREAM_SERVICES } from '../src/index';
import { parseProjectId, parseTaskId, parseUserId } from '../src/routes/Project/project_helpers';

describe('upstream URL configuration', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('the entry point checks every upstream the BFF calls', () => {
    expect([...UPSTREAM_SERVICES].sort()).toEqual(['CORE_API', 'PROJECT_API', 'USER_BFF']);
  });

  test('startup fails naming every missing or invalid upstream URL, without a localhost default', () => {
    for (const service of UPSTREAM_SERVICES) {
      delete process.env[`${service}_URL`];
      delete process.env[`${service}_PORT`];
    }
    process.env.CORE_API_URL = 'core-api';
    process.env.PROJECT_API_URL = 'http://project-api:3001';
    process.env.PROJECT_API_PORT = 'not-a-port';

    expect(() => assertConfigured(UPSTREAM_SERVICES)).toThrow('Missing or invalid upstream configuration: USER_BFF_URL');
    delete process.env.PROJECT_API_URL;
    expect(() => assertConfigured(UPSTREAM_SERVICES)).toThrow('USER_BFF_URL, PROJECT_API_URL');
  });

  test('startup passes once every upstream is configured', () => {
    process.env.USER_BFF_URL = 'http://bff-user:4000';
    process.env.PROJECT_API_URL = 'project-api';
    process.env.PROJECT_API_PORT = '3001';
    process.env.CORE_API_URL = 'core-api:3000';

    expect(() => assertConfigured(UPSTREAM_SERVICES)).not.toThrow();
  });
});

describe('public id parsing', () => {
  test('ids are anchored on their own prefix', () => {
    expect([parseProjectId('project-5'), parseTaskId('task-7'), parseUserId('user-9')]).toEqual([5, 7, 9]);
    expect(['user-5', 'abc12', 'project-5x', 'xproject-5', '5', 'project-', undefined].map(parseProjectId))
      .toEqual([null, null, null, null, null, null, null]);
    expect([parseTaskId('project-7'), parseUserId('task-9')]).toEqual([null, null]);
  });
});
