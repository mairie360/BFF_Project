import { HttpError } from '@mairie360/bffs-lib';
import { getUserBffUrl } from '../src/auth/project-user';
import { projectApiHealthBaseUrl } from '../src/routes/check_apis';
import { parseProjectId, parseTaskId, parseUserId } from '../src/routes/Project/project_helpers';

describe('upstream URL configuration', () => {
  test.each([
    ['project-api', '3001', 'http://project-api:3001'],
    ['http://project-api:3001', undefined, 'http://project-api:3001'],
    ['http://project-api:3001/', '9999', 'http://project-api:3001'],
    ['https://project.example.org', '', 'https://project.example.org'],
  ])('projectApiHealthBaseUrl(%p, %p) is %p', (host, port, expected) => {
    expect(projectApiHealthBaseUrl(host, port)).toBe(expected);
  });

  test('projectApiHealthBaseUrl refuses a missing PROJECT_API_URL', () => {
    expect(() => projectApiHealthBaseUrl('', '3001')).toThrow('PROJECT_API_URL is not configured');
  });

  test('getUserBffUrl defaults to localhost outside production only', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(getUserBffUrl({ NODE_ENV: 'development' })).toBe('http://localhost:4000');
    expect(getUserBffUrl({ NODE_ENV: 'production', USER_BFF_URL: 'bff-user:4000/' })).toBe('http://bff-user:4000');
    expect(() => getUserBffUrl({ NODE_ENV: 'production' })).toThrow(HttpError);
    jest.restoreAllMocks();
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
