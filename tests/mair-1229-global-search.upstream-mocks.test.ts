import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { ContractMockServer } from './support/contract-mock-server';
import { OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract } from './support/orval-contract';
import { captureLogs } from './support/logs';
import { eddsaToken, useSessionPublicKey } from './support/session-keys';

// The header's global search (GET /search): this BFF queries the five business APIs itself, never another BFF.
// Each API is a mock checked against its published contract (@mairie360/<x>-api-openapi).

const SEARCH = '/api/v1/search';
const apis = {
  agents: new ContractMockServer('CORE_API', loadOrvalContract('@mairie360/core-api-openapi')),
  projects: new ContractMockServer('PROJECT_API', loadOrvalContract('@mairie360/project-api-openapi')),
  calendar: new ContractMockServer('CALENDAR_API', loadOrvalContract('@mairie360/calendar-api-openapi')),
  messages: new ContractMockServer('MESSAGE_API', loadOrvalContract('@mairie360/message-api-openapi')),
  elearning: new ContractMockServer('ELEARNING_API', loadOrvalContract('@mairie360/elearning-api-openapi')),
};
const mocks = Object.values(apis);
const bffContract = OpenApiContract.load(path.join(__dirname, '..', 'contracts', 'openapi.json'));

type Item = { kind: string; id: number; title: string; excerpt: string | null; parent_id: number | null; updated_at: string };
const item = (kind: string, id: number, title: string, parent_id: number | null = null): Item => ({
  kind, id, title, excerpt: null, parent_id, updated_at: '2026-11-26T10:00:00Z',
});

let app: Express;
const token = eddsaToken(7);

beforeAll(async () => {
  await Promise.all(mocks.map((mock) => mock.start()));
  ({ default: app } = await import('../src/app'));
});
afterAll(async () => { await Promise.all(mocks.map((mock) => mock.stop())); });

beforeEach(() => {
  useSessionPublicKey();
  captureLogs();
  for (const mock of mocks) {
    mock.reset();
    const url = new URL(mock.url);
    process.env[`${mock.service}_URL`] = url.hostname;
    process.env[`${mock.service}_PORT`] = url.port;
    mock.on('get', SEARCH, { body: { items: [] } });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  expect(mocks.flatMap((mock) => mock.violations)).toEqual([]);
});

function expectBffContract(response: request.Response) {
  const match = bffContract.match('get', '/search');
  expect(match?.template).toBe('/search');
  const { documented, schema } = bffContract.responseSchema(match!, response.status);
  expect({ status: response.status, documented }).toEqual({ status: response.status, documented: true });
  if (schema) expect(bffContract.validate(schema, response.body)).toEqual([]);
}

describe('MAIR-1229 global search', () => {
  test('merges the results of the five business APIs by module, queried with the caller token', async () => {
    apis.agents.on('get', SEARCH, { body: { items: [item('agent', 4, 'Anne Dupont')] } });
    apis.projects.on('get', SEARCH, { body: { items: [item('project', 7, 'Voirie Dupont'), item('task', 9, 'Devis Dupont', 7)] } });
    apis.elearning.on('get', SEARCH, { body: { items: [item('course', 2, 'Accueil Dupont')] } });

    const response = await request(app).get('/search?q=%20dupont%20&limit=5').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      groups: [
        { module: 'agents', items: [item('agent', 4, 'Anne Dupont')] },
        { module: 'projects', items: [item('project', 7, 'Voirie Dupont'), item('task', 9, 'Devis Dupont', 7)] },
        { module: 'elearning', items: [item('course', 2, 'Accueil Dupont')] },
      ],
      unavailable: [],
    });
    for (const mock of mocks) {
      const [call] = mock.calls(SEARCH, 'get');
      expect(call.url.searchParams.get('q')).toBe('dupont');
      expect(call.url.searchParams.get('limit')).toBe('5');
      expect(call.headers.authorization).toBe(`Bearer ${token}`);
    }
    expectBffContract(response);
  });

  test('an API that fails or is not configured is unavailable, the others are still shown', async () => {
    apis.calendar.on('get', SEARCH, { status: 503, raw: 'busy', contentType: 'text/plain', outOfContract: true });
    apis.messages.on('get', SEARCH, { body: { items: [item('message', 3, 'Rendez-vous dupont')] } });
    delete process.env.ELEARNING_API_URL;

    const response = await request(app).get('/search?q=dupont').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      groups: [{ module: 'messages', items: [item('message', 3, 'Rendez-vous dupont')] }],
      unavailable: ['calendar', 'elearning'],
    });
    expectBffContract(response);
  });

  test('a session an API refuses is a 401', async () => {
    apis.agents.on('get', SEARCH, { status: 401, raw: 'Session revoked', contentType: 'text/plain', outOfContract: true });

    const response = await request(app).get('/search?q=dupont').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expectBffContract(response);
  });

  test('without a session, 401 before any upstream call', async () => {
    const response = await request(app).get('/search?q=dupont');

    expect(response.status).toBe(401);
    expect(mocks.flatMap((mock) => mock.requests)).toEqual([]);
    expectBffContract(response);
  });

  test.each([
    ['a one-character term', '?q=a', 'query.q'],
    ['a missing term', '', 'query.q'],
    ['a limit over 20', '?q=dupont&limit=21', 'query.limit'],
  ])('%s is a 400 naming the field, before any upstream call', async (_label, query, field) => {
    const response = await request(app).get(`/search${query}`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain(field);
    expect(mocks.flatMap((mock) => mock.requests)).toEqual([]);
    expectBffContract(response);
  });
});
