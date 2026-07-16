import http from 'http';
import request from 'supertest';
import type { AddressInfo } from 'net';

describe('Project BFF smoke tests', () => {
  let mockServer: http.Server;
  let userBffServer: http.Server;
  let app: typeof import('../src/app').default;
  const authorization = 'Bearer integration-token';

  beforeAll(async () => {
    process.env.START_MOCK_PROJECT_API = 'false';
    process.env.MOCK_PROJECT_API_TOKEN = 'integration-token';
    process.env.PROJECT_DB_ACCESS = 'disabled';
    userBffServer = http.createServer((req, res) => {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      const role = token === 'user-token' ? 'User' : token === 'manager-token' ? 'Responsable' : 'Admin';
      const id = role === 'Admin' ? 1 : 2;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        user: { id, first_name: role, last_name: 'Projet', email: `${role.toLowerCase()}@example.test`, role },
        groups: [{ id: 1, name: 'Service test' }],
        roles: [role],
      }));
    });
    userBffServer.listen(0);
    await new Promise<void>((resolve) => userBffServer.once('listening', resolve));
    process.env.USER_BFF_URL = `http://127.0.0.1:${(userBffServer.address() as AddressInfo).port}`;
    const mockModule = await import('../scripts/mock-project-api');
    mockServer = mockModule.default.listen(0);

    const mockPort = (mockServer.address() as AddressInfo).port;
    process.env.PROJECT_API_BASE_PATH = `http://127.0.0.1:${mockPort}`;
    process.env.PORT = '3000';

    app = (await import('../src/app')).default;
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve) => mockServer.close(() => resolve())),
      new Promise<void>((resolve) => userBffServer.close(() => resolve())),
    ]);
  });

  it('returns ok on health', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('rejects project routes without a bearer token', async () => {
    const response = await request(app).get('/projects-page');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns a projects page payload', async () => {
    const response = await request(app).get('/projects-page').set('Authorization', authorization);

    expect(response.status).toBe(200);
    expect(response.body.page.title).toBe('Projets');
    expect(response.body.access).toMatchObject({ role: 'Admin', scope: 'all', canCreateProject: true });
    expect(Array.isArray(response.body.projects)).toBe(true);
    expect(response.body.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'project-1', title: 'Plateforme RH' }),
      ]),
    );
    expect(response.body.options.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'user-1', label: 'Alice Martin', name: 'Alice Martin' }),
      ]),
    );
  });

  it('forbids project creation for an employee', async () => {
    const response = await request(app)
      .post('/projects')
      .set('Authorization', 'Bearer user-token')
      .send({
        title: 'Projet interdit',
        description: 'Un employé ne doit pas créer de projet.',
        status: 'todo',
        priority: 'medium',
        responsibleId: 'user-2',
        assigneeIds: ['user-2'],
        labels: [],
        dueDate: '2026-07-01T00:00:00Z',
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns project details in the frontend contract', async () => {
    const response = await request(app)
      .get('/projects/project-1')
      .set('Authorization', authorization);

    expect(response.status).toBe(200);
    expect(response.body.project).toMatchObject({
      id: 'project-1',
      title: 'Plateforme RH',
      tasks: { total: 2 },
    });
    expect(response.body.taskItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'task-1', title: 'Créer le socle API' })]),
    );
  });

  it('exposes employee permissions without management actions', async () => {
    const response = await request(app)
      .get('/projects/project-1')
      .set('Authorization', 'Bearer user-token');

    expect(response.status).toBe(200);
    expect(response.body.project.permissions).toMatchObject({
      canView: true,
      canEdit: false,
      canCreateTask: false,
      canAssignMembers: false,
      canClose: false,
    });
    expect(response.body.taskItems).toHaveLength(1);
    expect(response.body.taskItems[0]).toMatchObject({
      id: 'task-2',
      responsible: { id: 'user-2' },
    });
    expect(response.body.taskItems[0].permissions).toMatchObject({
      canEdit: false,
      canDelete: false,
      canUpdateStatus: true,
      canComment: true,
    });
  });

  it('allows an employee to update only the status of their assigned task', async () => {
    const allowedResponse = await request(app)
      .patch('/projects/project-1/tasks/task-2/status')
      .set('Authorization', 'Bearer user-token')
      .send({ status: 'in-progress' });

    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.body).toMatchObject({
      id: 'task-2',
      status: 'in-progress',
      responsible: { id: 'user-2' },
      permissions: {
        canEdit: false,
        canUpdateStatus: true,
      },
    });

    const forbiddenResponse = await request(app)
      .patch('/projects/project-1/tasks/task-1/status')
      .set('Authorization', 'Bearer user-token')
      .send({ status: 'done' });

    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body.error).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('creates a project through the mock backend', async () => {
    const response = await request(app)
      .post('/projects')
      .set('Authorization', authorization)
      .send({
        title: 'Demo rapide',
        description: 'Projet de test',
        status: 'todo',
        priority: 'medium',
        responsibleId: 'user-1',
        assigneeIds: ['user-1'],
        labels: [],
        dueDate: '2026-07-01T00:00:00Z',
        taskItems: [
          {
            title: 'Préparer le lancement',
            status: 'todo',
            priority: 'high',
            assigneeIds: ['user-1'],
            labels: ['Urgent'],
            dueDate: '2026-06-25T00:00:00Z',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.project.title).toBe('Demo rapide');
    expect(response.body.project.responsible).toMatchObject({ id: 'user-1', name: 'Alice Martin' });
    expect(response.body.taskItems).toHaveLength(1);
  });

  it('persists project and task changes through the Project API', async () => {
    const projectResponse = await request(app)
      .patch('/projects/project-1')
      .set('Authorization', authorization)
      .send({
        title: 'Plateforme RH actualisée',
        description: 'Description mise à jour',
        responsibleId: 'user-2',
        assigneeIds: ['user-2'],
      });

    expect(projectResponse.status).toBe(200);
    expect(projectResponse.body.project).toMatchObject({
      title: 'Plateforme RH actualisée',
      description: 'Description mise à jour',
      responsible: { id: 'user-2', name: 'Nicolas Dupont' },
    });

    const taskResponse = await request(app)
      .patch('/projects/project-1/tasks/task-1')
      .set('Authorization', authorization)
      .send({
        title: 'Socle API finalisé',
        priority: 'low',
        responsibleId: 'user-2',
        dueDate: '2026-07-20T00:00:00Z',
      });

    expect(taskResponse.status).toBe(200);
    expect(taskResponse.body).toMatchObject({
      id: 'task-1',
      title: 'Socle API finalisé',
      priority: 'low',
      responsible: { id: 'user-2', name: 'Nicolas Dupont' },
    });

    const statusResponse = await request(app)
      .patch('/projects/project-1/tasks/task-1/status')
      .set('Authorization', authorization)
      .send({ status: 'done' });

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body).toMatchObject({ id: 'task-1', status: 'done', completed: true });

    const refreshedDetails = await request(app)
      .get('/projects/project-1')
      .set('Authorization', authorization);
    expect(refreshedDetails.body.project.title).toBe('Plateforme RH actualisée');
    expect(refreshedDetails.body.taskItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Socle API finalisé', status: 'done' })]),
    );
  });

  it('stores comments and exposes task history', async () => {
    const commentResponse = await request(app)
      .post('/projects/project-1/tasks/task-1/comments')
      .set('Authorization', authorization)
      .send({ message: 'Validation fonctionnelle terminée.' });

    expect(commentResponse.status).toBe(201);
    expect(commentResponse.body).toMatchObject({
      message: 'Validation fonctionnelle terminée.',
      author: { id: 'user-1', name: 'Admin Projet' },
    });

    const collaborationResponse = await request(app)
      .get('/projects/project-1/tasks/task-1/collaboration')
      .set('Authorization', authorization);

    expect(collaborationResponse.status).toBe(200);
    expect(collaborationResponse.body.comments).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Validation fonctionnelle terminée.' })]),
    );
    expect(collaborationResponse.body.history.length).toBeGreaterThan(0);
  });

  it('allows a manager to suspend a project', async () => {
    const response = await request(app)
      .patch('/projects/project-1/close')
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'review' });

    expect(response.status).toBe(200);
    expect(response.body.project).toMatchObject({ status: 'review', statusLabel: 'En revue' });
  });
});
