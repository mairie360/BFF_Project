import http from 'http';
import request from 'supertest';
import type { AddressInfo } from 'net';

describe('Project BFF smoke tests', () => {
  let mockServer: http.Server;
  let bffServer: http.Server;
  let app: typeof import('../src/app').default;

  beforeAll(async () => {
    process.env.START_MOCK_PROJECT_API = 'false';
    const mockModule = await import('../scripts/mock-project-api');
    mockServer = mockModule.default.listen(0);

    const mockPort = (mockServer.address() as AddressInfo).port;
    process.env.PROJECT_API_URL = `http://127.0.0.1:${mockPort}`;
    process.env.PORT = '3000';

    app = (await import('../src/app')).default;
    bffServer = app.listen(0);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => bffServer.close(() => resolve()));
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  it('returns ok on health', async () => {
    const response = await request(bffServer).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a projects page payload', async () => {
    const response = await request(bffServer).get('/projects-page');

    expect(response.status).toBe(200);
    expect(response.body.page.title).toBe('Projects');
    expect(Array.isArray(response.body.projects)).toBe(true);
  });

  it('creates a project through the mock backend', async () => {
    const response = await request(bffServer)
      .post('/projects')
      .send({
        title: 'Demo rapide',
        description: 'Projet de test',
        status: 'todo',
        priority: 'medium',
        responsibleId: 'user-1',
        assigneeIds: ['user-1'],
        labels: [],
        dueDate: '2026-07-01T00:00:00Z',
      });

    expect(response.status).toBe(201);
    expect(response.body.project.title).toBe('Demo rapide');
  });
});
