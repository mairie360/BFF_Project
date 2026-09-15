import path from 'node:path';
import type { Express, Request, Response } from 'express';
import request from 'supertest';
import { ContractMockServer, unreachableUrl, type MockReply } from './support/contract-mock-server';
import { OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract } from './support/orval-contract';
import { agents, bearer, projetView, sessionResponse, taskView, type Agent } from './support/project-fixtures';

// Mode Project API (PROJECT_DB_ACCESS=disabled) : toute l'application est testée avec le vrai client orval/axios
// contre de vrais serveurs HTTP simulant BFF User (GET /me), Project API et Core API (/check_apis). Leurs contrats
// sont reconstruits depuis les paquets @mairie360/*-openapi installés (tests/support/orval-contract.ts) : chaque
// mock refuse les routes, paramètres et corps absents du contrat amont et valide ses réponses de succès. Les
// erreurs ne sont pas typées par orval : toute réponse d'erreur simulée est marquée `outOfContract`. Chaque
// réponse du BFF est validée contre contracts/openapi.json. Le repository n'interroge pas PostgreSQL dans ce mode.

const userBff = new ContractMockServer('USER_BFF', loadOrvalContract('@mairie360/bff-user-openapi'));
const projectApi = new ContractMockServer('PROJECT_API', loadOrvalContract('@mairie360/project-api-openapi'));
const coreApi = new ContractMockServer('CORE_API', loadOrvalContract('@mairie360/core-api-openapi'));
const mocks = [userBff, projectApi, coreApi];
const bffContract = OpenApiContract.load(path.join(__dirname, '..', 'contracts', 'openapi.json'));

let app: Express;
let helpers: typeof import('../src/routes/Project/project_helpers');
let tokenContextMiddleware: typeof import('../src/auth/token').tokenContextMiddleware;

beforeAll(async () => {
  await Promise.all(mocks.map((mock) => mock.start()));
  // projectClient lit PROJECT_API_BASE_PATH au chargement : l'application est importée après.
  process.env.PROJECT_API_BASE_PATH = projectApi.url;
  process.env.PROJECT_DB_ACCESS = 'disabled';
  app = (await import('../src/app')).default;
  helpers = await import('../src/routes/Project/project_helpers');
  ({ tokenContextMiddleware } = await import('../src/auth/token'));
});
afterAll(async () => { await Promise.all(mocks.map((mock) => mock.stop())); });

beforeEach(() => {
  for (const mock of mocks) mock.reset();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  // project-user.ts relit USER_BFF_URL à chaque requête, check_apis relit hôte et port des API.
  process.env.USER_BFF_URL = userBff.url;
  for (const api of [coreApi, projectApi]) {
    const url = new URL(api.url);
    process.env[`${api.service}_URL`] = url.hostname;
    process.env[`${api.service}_PORT`] = url.port;
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  expect(mocks.flatMap((mock) => mock.violations)).toEqual([]);
});

function expectBffContract(method: string, pathname: string, response: request.Response) {
  const match = bffContract.match(method, pathname);
  expect(match?.template).toBeDefined();
  const { documented, schema } = bffContract.responseSchema(match!, response.status);
  expect({ status: response.status, documented }).toEqual({ status: response.status, documented: true });
  if (schema) expect(bffContract.validate(schema, response.body)).toEqual([]);
}

const signIn = (agent: Agent, reply: MockReply = { body: sessionResponse(agent) }) => userBff.on('get', '/me', reply);
const as = (call: request.Test, agent: Agent) => call.set('Authorization', bearer(agent.id));
const upstreamSequence = () => projectApi.requests.map((call) => `${call.method} ${call.path}`);
/** Erreur texte d'actix/mairie360_api_lib : non typée par orval, donc hors contrat. */
const textError = (status: number, raw: string): MockReply => ({ status, raw, contentType: 'text/plain', outOfContract: true });

/** Exécute un helper dans le contexte de jeton d'une requête, comme le fait tokenContextMiddleware. */
function withAuthorization<T>(authorization: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = { header: () => authorization } as unknown as Request;
    tokenContextMiddleware(req, {} as Response, () => { fn().then(resolve, reject); });
  });
}

describe('Project BFF in Project API mode with contract-driven upstream mocks', () => {
  describe('session resolution through BFF User GET /me', () => {
    test('rejects project routes without a bearer before calling any upstream', async () => {
      const responses = await Promise.all([
        request(app).get('/projects-page'),
        request(app).get('/projects-page').set('Authorization', 'Basic YWRtaW46YWRtaW4='),
      ]);

      expect(responses.map((response) => [response.status, response.body.error.code])).toEqual([[401, 'UNAUTHORIZED'], [401, 'UNAUTHORIZED']]);
      responses.forEach((response) => expectBffContract('get', '/projects-page', response));
      expect(responses[1].body.error.message).toBe('Invalid authorization header. Expected: Bearer <token>');
      expect(mocks.flatMap((mock) => mock.requests)).toEqual([]);
    });

    test('forwards the caller session to /me and normalizes role aliases', async () => {
      signIn(agents.marie, { body: { ...sessionResponse(agents.marie, { role: 'manager' }), roles: ['Utilisateur', { id: 9, name: 'ROLE_RESPONSABLE' }] } });
      projectApi.on('get', '/api/v1/projects/', { body: { projects: [] } });

      const response = await as(request(app).get('/projects-page'), agents.marie);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.access).toEqual({
        role: 'Responsable', scope: 'team', canCreateProject: true, canManageProjects: true, canManageTasks: true,
        canUpdateAssignedTaskStatus: true, canCommentTasks: true,
      });
      const [me] = userBff.calls('/me', 'get');
      expect(me.headers).toMatchObject({ authorization: bearer(agents.marie.id), accept: 'application/json' });
      expect(projectApi.calls('/api/v1/projects/', 'get')[0].headers.authorization).toBe(bearer(agents.marie.id));
    });

    test('downgrades a session without a known role to Guest', async () => {
      signIn(agents.alice, { body: { ...sessionResponse(agents.alice, { role: 'Stagiaire' }), roles: [] } });
      projectApi.on('get', '/api/v1/projects/', { body: { projects: [] } });

      const response = await as(request(app).get('/projects-page'), agents.alice);

      expect(response.status).toBe(200);
      expect(response.body.access).toMatchObject({ role: 'Guest', scope: 'assigned', canCreateProject: false, canManageTasks: false });
    });

    test('falls back to the JWT sub when /me has no user id', async () => {
      const body = sessionResponse(agents.admin);
      delete (body.user as { id?: number }).id;
      signIn(agents.admin, { body });

      const response = await request(app).post('/projects/project-41/tasks/task-1/comments')
        .set('Authorization', bearer(42)).send({ message: 'Relu par le service juridique.' });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-41/tasks/task-1/comments', response);
      expect(response.body.author).toEqual({ id: 'user-42', name: 'Admin Mairie' });
    });

    test('rejects a session that neither /me nor the token can identify', async () => {
      const body = sessionResponse(agents.admin);
      delete (body.user as { id?: number }).id;
      signIn(agents.admin, { body });

      const response = await request(app).get('/projects-page').set('Authorization', 'Bearer opaque-token');

      expect(response.status).toBe(401);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'UNAUTHORIZED', message: 'Impossible d’identifier l’utilisateur connecté.', details: [] });
      expect(projectApi.requests).toHaveLength(0);
    });

    test('propagates a BFF User 401 without calling Project API', async () => {
      signIn(agents.alice, { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Token expiré', details: [] } }, outOfContract: true });

      const response = await as(request(app).get('/projects-page'), agents.alice);

      expect(response.status).toBe(401);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'UNAUTHORIZED', message: 'La session a expiré.', details: [] });
      expect(projectApi.requests).toHaveLength(0);
    });

    test.each([
      ['a BFF User 500', { status: 500, body: { message: 'boom' }, outOfContract: true }, 'Le contexte utilisateur est indisponible.'],
      ['an invalid JSON body', { raw: '<html>proxy</html>', contentType: 'text/html' }, 'Le contexte utilisateur est indisponible.'],
      ['a dropped connection', { dropConnection: true }, 'Le service utilisateur est indisponible.'],
    ] as Array<[string, MockReply, string]>)('maps %s to 502 without leaking details', async (_label, reply, message) => {
      signIn(agents.alice, reply);

      const response = await as(request(app).get('/projects-page'), agents.alice);

      expect(response.status).toBe(502);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'BAD_GATEWAY', message, details: [] });
    });

    test('maps an unreachable BFF User to 502', async () => {
      process.env.USER_BFF_URL = await unreachableUrl();

      const response = await as(request(app).get('/projects-page'), agents.alice);

      expect(response.status).toBe(502);
      expect(response.body.error.message).toBe('Le service utilisateur est indisponible.');
    });
  });

  describe('GET /projects-page', () => {
    test('returns the page payload when Project API lists no project', async () => {
      signIn(agents.admin);
      projectApi.on('get', '/api/v1/projects/', { body: { projects: [] } });

      const response = await as(request(app).get('/projects-page?q=voirie&status=todo&priority=high&view=grid&page=2&limit=5'), agents.admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(upstreamSequence()).toEqual(['GET /api/v1/projects/']);
      expect(response.body).toMatchObject({
        access: { role: 'Admin', scope: 'all', canCreateProject: true },
        page: { title: 'Projets', defaultView: 'grid' },
        filters: { search: 'voirie', status: 'todo', priority: 'high' },
        options: { members: [], labels: [] },
        summary: { totalProjects: 0, projectsByStatus: { todo: 0, 'in-progress': 0, review: 0, done: 0 } },
        projects: [],
        pagination: { page: 2, limit: 5, total: 0, hasNextPage: false },
      });
      expect(response.body.kanban.columns.map((column: { status: string; count: number }) => [column.status, column.count]))
        .toEqual([['todo', 0], ['in-progress', 0], ['review', 0], ['done', 0]]);
    });

    test('answers a documented 501 as soon as a project must be read, Project API 0.4.1 having no GET project', async () => {
      signIn(agents.admin);
      projectApi.on('get', '/api/v1/projects/', { body: { projects: [projetView(1), projetView(2)] } });

      const response = await as(request(app).get('/projects-page'), agents.admin);

      expect(response.status).toBe(501);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toMatchObject({ code: 'NOT_IMPLEMENTED', message: expect.stringContaining('PROJECT_DB_ACCESS') });
      expect(upstreamSequence()).toEqual(['GET /api/v1/projects/']);
    });

    test('rejects an invalid query with 400 before calling Project API', async () => {
      signIn(agents.admin);

      const response = await as(request(app).get('/projects-page?status=archived'), agents.admin);

      expect(response.status).toBe(400);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Validation failed', details: [expect.objectContaining({ path: ['status'] })] });
      expect(projectApi.requests).toHaveLength(0);
    });

    test.each([
      ['a JWT rejection (401)', textError(401, 'Unauthorized'), 401, 'UNAUTHORIZED', 'La session a été refusée par Project API.'],
      ['a database error (500)', textError(500, 'An error occurred while accessing the database.'), 502, 'BAD_GATEWAY', 'Project API est indisponible.'],
      ['a dropped connection', { dropConnection: true }, 502, 'BAD_GATEWAY', 'Project API est indisponible.'],
    ] as Array<[string, MockReply, number, string, string]>)('maps %s without leaking the upstream error', async (_label, reply, status, code, message) => {
      signIn(agents.admin);
      projectApi.on('get', '/api/v1/projects/', reply);

      const response = await as(request(app).get('/projects-page'), agents.admin);

      expect(response.status).toBe(status);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code, message, details: [] });
      expect(JSON.stringify(response.body)).not.toMatch(/database|127\.0\.0\.1|ECONN/);
    });
  });

  describe('project and task routes', () => {
    test('GET /projects/:id answers 501 without calling Project API', async () => {
      signIn(agents.admin);

      const response = await as(request(app).get('/projects/project-1'), agents.admin);

      expect(response.status).toBe(501);
      expectBffContract('get', '/projects/project-1', response);
      expect(projectApi.requests).toHaveLength(0);
    });

    test('rejects a public id without a numeric suffix with 400', async () => {
      signIn(agents.admin);

      const response = await as(request(app).get('/projects/projet-abc'), agents.admin);

      expect(response.status).toBe(400);
      expectBffContract('get', '/projects/projet-abc', response);
      expect(response.body.error.details).toEqual([expect.objectContaining({ path: ['projectId'] })]);
    });

    test('DELETE /projects/:id deletes through Project API with the caller session', async () => {
      signIn(agents.admin);
      projectApi.on('delete', '/api/v1/projects/{projectId}/', { status: 204 });

      const response = await as(request(app).delete('/projects/project-7'), agents.admin);

      expect(response.status).toBe(204);
      expectBffContract('delete', '/projects/project-7', response);
      expect(upstreamSequence()).toEqual(['DELETE /api/v1/projects/7/']);
      expect(projectApi.requests[0].headers.authorization).toBe(bearer(agents.admin.id));
    });

    test('DELETE /projects/:id/tasks/:taskId lets a Responsable delete through Project API', async () => {
      signIn(agents.marie);
      projectApi.on('delete', '/api/v1/projects/{projectId}/tasks/{taskId}/', { status: 204 });

      const response = await as(request(app).delete('/projects/project-7/tasks/task-3'), agents.marie);

      expect(response.status).toBe(204);
      expectBffContract('delete', '/projects/project-7/tasks/task-3', response);
      expect(projectApi.calls('/api/v1/projects/{projectId}/tasks/{taskId}/', 'delete').map((call) => call.pathParams)).toEqual([{ projectId: '7', taskId: '3' }]);
    });

    test.each([
      ['post', '/projects', { title: 'Projet interdit', description: 'x', status: 'todo', priority: 'medium', responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-07-01T00:00:00Z' }],
      ['delete', '/projects/project-7', undefined],
      ['delete', '/projects/project-7/tasks/task-3', undefined],
    ] as const)('forbids an employee to %s %s without calling Project API', async (method, url, body) => {
      signIn(agents.alice);

      const response = await as(request(app)[method](url).send(body), agents.alice);

      expect(response.status).toBe(403);
      expectBffContract(method, url, response);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(projectApi.requests).toHaveLength(0);
    });

    test('maps a Project API 400 on delete to 400 without echoing its body', async () => {
      signIn(agents.admin);
      projectApi.on('delete', '/api/v1/projects/{projectId}/', textError(400, 'Unknown project.'));

      const response = await as(request(app).delete('/projects/project-404'), agents.admin);

      expect(response.status).toBe(400);
      expectBffContract('delete', '/projects/project-404', response);
      expect(response.body.error).toEqual({ code: 'BAD_REQUEST', message: 'La requête a été refusée par Project API.', details: [] });
    });

    test.each([
      ['post', '/projects', { title: 'Fête du village', description: 'x', status: 'todo', priority: 'medium', responsibleId: 'user-2', assigneeIds: ['user-3'], labels: [], dueDate: '2026-07-14T00:00:00Z', taskItems: [{ title: 'Salle', status: 'todo', priority: 'high', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }] }],
      ['patch', '/projects/project-7', { title: 'Renommé', assigneeIds: ['user-2'] }],
      ['patch', '/projects/project-7/close', { status: 'done' }],
      ['post', '/projects/project-7/tasks', { title: 'Salle', status: 'todo', priority: 'high', responsibleId: 'user-2', assigneeIds: ['user-2'], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
    ] as const)('answers %s %s with 501 before writing anything to Project API', async (method, url, body) => {
      // Project_API 0.4.1 ne permet pas de relire le projet écrit (ni de le modifier) : écrire puis répondre 501
      // laisserait des projets, tâches ou membres orphelins côté API.
      signIn(agents.marie);

      const response = await as(request(app)[method](url).send(body), agents.marie);

      expect(response.status).toBe(501);
      expectBffContract(method, url, response);
      expect(response.body.error).toMatchObject({ code: 'NOT_IMPLEMENTED', message: expect.stringContaining('PROJECT_DB_ACCESS') });
      expect(projectApi.requests).toHaveLength(0);
    });

    test('rejects an invalid project body with 400 before calling Project API', async () => {
      signIn(agents.admin);

      const response = await as(request(app).post('/projects').send({ title: 'Sans le reste' }), agents.admin);

      expect(response.status).toBe(400);
      expectBffContract('post', '/projects', response);
      expect(projectApi.requests).toHaveLength(0);
    });
  });

  describe('task collaboration (in-memory without database)', () => {
    test('stores a comment and exposes it with the task history, without calling Project API', async () => {
      signIn(agents.admin);

      const comment = await as(request(app).post('/projects/project-50/tasks/task-5/comments'), agents.admin)
        .send({ message: '  Validation fonctionnelle terminée.  ' });
      const collaboration = await as(request(app).get('/projects/project-50/tasks/task-5/collaboration'), agents.admin);

      expect(comment.status).toBe(201);
      expectBffContract('post', '/projects/project-50/tasks/task-5/comments', comment);
      expect(comment.body).toEqual({
        id: expect.stringMatching(/^comment-/), message: 'Validation fonctionnelle terminée.',
        author: { id: 'user-1', name: 'Admin Mairie' }, createdAt: expect.any(String),
      });
      expect(collaboration.status).toBe(200);
      expectBffContract('get', '/projects/project-50/tasks/task-5/collaboration', collaboration);
      expect(collaboration.body).toEqual({ comments: [comment.body], history: [] });
      expect(projectApi.requests).toHaveLength(0);
    });

    test('rejects an empty comment with 400', async () => {
      signIn(agents.admin);

      const response = await as(request(app).post('/projects/project-50/tasks/task-6/comments'), agents.admin).send({ message: '   ' });

      expect(response.status).toBe(400);
      expectBffContract('post', '/projects/project-50/tasks/task-6/comments', response);
    });
  });

  describe('Project API client helpers', () => {
    const session = bearer(agents.admin.id);

    test('fetchProjectsForUser lists projects from Project API', async () => {
      projectApi.on('get', '/api/v1/projects/', { body: { projects: [projetView(1), projetView(2, { status: 'Completed' })] } });

      const result = await withAuthorization(session, () => helpers.fetchProjectsForUser({
        id: 1, name: 'Admin Mairie', email: 'admin@mairie.test', role: 'Admin', roles: ['Admin'], groups: [],
      }));

      expect(result.projects.map((project) => [project.id, project.status])).toEqual([[1, 'Active'], [2, 'Completed']]);
      expect(projectApi.requests[0].headers.authorization).toBe(session);
    });

    test('createProjectOnApi sends a CreateProjectView built from the BFF body', async () => {
      projectApi.on('post', '/api/v1/projects/', { body: { project_id: 12 } });

      const created = await withAuthorization(session, () => helpers.createProjectOnApi(helpers.mapProjectCreateBodyToBackend({
        title: 'Fête du village', description: 'Organisation de la fête', status: 'todo', priority: 'high',
        responsibleId: 'user-2', assigneeIds: ['user-3'], labels: ['événement'], dueDate: '2026-07-14T00:00:00Z',
      })));

      expect(created).toEqual({ project_id: 12 });
      expect(projectApi.calls('/api/v1/projects/', 'post')[0].body).toEqual({ name: 'Fête du village', description: 'Organisation de la fête' });
    });

    test('createProjectOnApi rejects the project id 0 that the contract allows', async () => {
      projectApi.on('post', '/api/v1/projects/', { body: { project_id: 0 } });

      await expect(withAuthorization(session, () => helpers.createProjectOnApi({ name: 'Projet' })))
        .rejects.toMatchObject({ status: 502 });
    });

    test('createTaskOnApi sends a CreateTaskView with mapped status, priority, assignee and dynamic fields', async () => {
      projectApi.on('post', '/api/v1/projects/{projectId}/tasks/', ({ body }) => ({ body: { task_id: 30, name: (body as { name: string }).name, description: null } }));

      const created = await withAuthorization(session, () => helpers.createTaskOnApi(12, helpers.mapTaskInputToBackend({
        title: 'Réserver la salle', status: 'review', priority: 'high', responsibleId: 'user-2',
        assigneeIds: ['user-2'], labels: ['Urgent'], dueDate: '2026-06-25T00:00:00Z',
      })));

      expect(created).toEqual({ task_id: 30, name: 'Réserver la salle', description: null });
      const [call] = projectApi.calls('/api/v1/projects/{projectId}/tasks/', 'post');
      expect(call.pathParams).toEqual({ projectId: '12' });
      expect(call.body).toEqual({
        name: 'Réserver la salle', status: 'Error', priority: 'High', assigned_to: 2, description: null, due_date: '2026-06-25T00:00:00Z',
        fields: [
          { label: 'Date', task_type: 'date', fields_options: [{ option: '2026-06-25T00:00:00Z', is_selected: true }] },
          { label: 'Urgent', task_type: 'select', fields_options: [{ option: 'Urgent', is_selected: true }] },
        ],
      });
    });

    test('syncProjectUsersOnApi only adds the missing members and ignores ids without a numeric suffix', async () => {
      projectApi.on('get', '/api/v1/projects/{projectId}/users/', { body: { users: [{ id: 1 }] } });
      projectApi.on('post', '/api/v1/projects/{projectId}/users/', { status: 200 });

      await withAuthorization(session, () => helpers.syncProjectUsersOnApi(12, ['user-1', 'user-2', 'user-2', 'personne']));

      expect(upstreamSequence()).toEqual(['GET /api/v1/projects/12/users/', 'POST /api/v1/projects/12/users/']);
      expect(projectApi.calls('/api/v1/projects/{projectId}/users/', 'post').map((call) => call.body)).toEqual([{ user_id: 2 }]);
    });

    test('syncProjectUsersOnApi adds every member when Project API cannot list them', async () => {
      projectApi.on('get', '/api/v1/projects/{projectId}/users/', textError(500, 'An error occurred while accessing the database.'));
      projectApi.on('post', '/api/v1/projects/{projectId}/users/', { status: 200 });

      await withAuthorization(session, () => helpers.syncProjectUsersOnApi(12, ['user-1', 'user-2']));

      expect(projectApi.calls('/api/v1/projects/{projectId}/users/', 'post').map((call) => call.body)).toEqual([{ user_id: 1 }, { user_id: 2 }]);
    });

    test('syncProjectUsersOnApi removes a member through the route the published contract misdeclares', async () => {
      // Le contrat publié par @mairie360/project-api-openapi 0.4.1 déclare ".../users/{userId}//" (#[utoipa::path]
      // sans `path`). Project_API est corrigé (tests/routing_test.rs) pour publier ".../users/{user_id}/", la route
      // appelée par le BFF. Tant que le paquet n'est pas republié puis monté ici, le mock refuse cet appel : ce test
      // échouera au bump, il faudra alors mocker la suppression et attendre un DELETE réussi.
      projectApi.on('get', '/api/v1/projects/{projectId}/users/', { body: { users: [{ id: 1 }] } });
      projectApi.on('post', '/api/v1/projects/{projectId}/users/', { status: 200 });

      await expect(withAuthorization(session, () => helpers.syncProjectUsersOnApi(12, ['user-2'])))
        .rejects.toMatchObject({ response: { status: 404 } });

      expect(projectApi.calls('/api/v1/projects/{projectId}/users/', 'post').map((call) => call.body)).toEqual([{ user_id: 2 }]);
      expect(projectApi.violations.splice(0)).toEqual([
        expect.stringContaining("DELETE /api/v1/projects/12/users/1/ n'existe pas dans le contrat project_api"),
      ]);
    });

    test('deleteProjectOnApi and deleteTaskOnApi call the contract delete operations', async () => {
      projectApi.on('delete', '/api/v1/projects/{projectId}/', { status: 204 });
      projectApi.on('delete', '/api/v1/projects/{projectId}/tasks/{taskId}/', { status: 204 });

      await withAuthorization(session, async () => {
        await helpers.deleteTaskOnApi(12, 30);
        await helpers.deleteProjectOnApi(12);
      });

      expect(upstreamSequence()).toEqual(['DELETE /api/v1/projects/12/tasks/30/', 'DELETE /api/v1/projects/12/']);
    });

    test('maps Project API tasks, users and project into BFF DTOs that satisfy the BFF contract', async () => {
      projectApi.on('get', '/api/v1/projects/{projectId}/tasks/', { body: { tasks: [
        taskView(1, { status: 'Completed', priority: 'Urgent', due_date: '2026-11-01T00:00:00Z', assigned_to: 2 }),
        taskView(2, { status: 'InProgress', priority: 'Low', due_date: '2026-10-15T00:00:00Z' }),
      ] } });
      projectApi.on('get', '/api/v1/projects/{projectId}/users/', { body: { users: [{ id: 3 }, { id: 2 }] } });

      const [tasks, users] = await withAuthorization(session, () => Promise.all([helpers.fetchProjectTasks(4), helpers.fetchProjectUsers(4)]));
      const project = helpers.mapProjectToDto(projetView(4, { name: 'Voirie', status: 'Suspended' }), tasks, users);
      const taskItems = tasks.map((task) => helpers.mapTaskToDto(task, users));

      expect(bffContract.validate(bffContract.schema('ProjectListItem'), project)).toEqual([]);
      taskItems.forEach((task) => expect(bffContract.validate(bffContract.schema('ProjectTask'), task)).toEqual([]));
      expect(project).toMatchObject({
        id: 'project-4', title: 'Voirie', status: 'review', statusLabel: 'En revue', priority: 'high', progress: 50,
        dueDate: '2026-10-15T00:00:00Z', tasks: { total: 2, completed: 1 },
        // Project API 0.4.1 ne publie que l'id des membres : le nom retombe sur « Inconnu ».
        responsible: { id: 'user-3', name: 'Inconnu', avatarUrl: null },
      });
      expect(taskItems.map((task) => [task.id, task.status, task.priority, task.completed, task.responsible.id, task.assignees.length]))
        .toEqual([['task-1', 'done', 'high', true, 'user-2', 1], ['task-2', 'in-progress', 'low', false, 'user-3', 0]]);
    });

    test('fetchProjectBundle is not available without database access', async () => {
      await expect(helpers.fetchProjectBundle(4)).rejects.toMatchObject({ status: 501 });
      expect(projectApi.requests).toHaveLength(0);
    });
  });

  describe('GET /check_apis', () => {
    beforeEach(() => {
      coreApi.on('get', '/health', { raw: 'OK', contentType: 'text/plain' });
      projectApi.on('get', '/health', { raw: 'OK', contentType: 'text/plain' });
    });

    test('reports both APIs connected through their /health operations', async () => {
      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(200);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'OK', core_api: 'Connected', project_api: 'Connected' });
      expect([...coreApi.requests, ...projectApi.requests].map((call) => call.url.pathname)).toEqual(['/health', '/health']);
    });

    test('reports each API independently and never returns network details', async () => {
      process.env.CORE_API_PORT = new URL(await unreachableUrl()).port;

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(502);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'Error', core_api: 'Unreachable', project_api: 'Connected' });
    });

    test('reports Project API unreachable when its /health fails or is not configured', async () => {
      projectApi.on('get', '/health', textError(500, 'KO'));
      const failing = await request(app).get('/check_apis');
      delete process.env.PROJECT_API_PORT;
      const unconfigured = await request(app).get('/check_apis');

      expect([failing.status, unconfigured.status]).toEqual([502, 502]);
      expect(failing.body).toEqual({ status: 'Error', core_api: 'Connected', project_api: 'Unreachable' });
      expect(unconfigured.body).toEqual(failing.body);
      expect(projectApi.requests).toHaveLength(1);
    });
  });
});
