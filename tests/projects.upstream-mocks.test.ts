import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { Express } from 'express';
import request from 'supertest';
import { ContractMockServer, unreachableUrl, type MockReply } from './support/contract-mock-server';
import { OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract } from './support/orval-contract';
import type { GetProjectResultView, ProjectListItemView } from '@mairie360/project-api-openapi/model';
import type { ListDirectoryUsersParams } from '@mairie360/core-api-openapi/model';
import {
  agents, bearer, collaboration, member, coreApiUrls, coreDirectory, createProjectResult, createTaskResult, projectApiUrls, projectBundle,
  milestoneView, projectListItem, projectUsersResult, projectsResult, projetView, coreMe, taskComment, taskHistoryEntry, taskView, type Agent,
} from './support/project-fixtures';
import { captureLogs } from './support/logs';

// The whole app is tested with the real orval/axios clients against real HTTP servers simulating Project API and
// Core API (caller's profile and roles, directory, /check_apis); no other BFF is called (MAIR-525). Leurs contrats sont reconstruits depuis
// les paquets @mairie360/*-openapi installés (tests/support/orval-contract.ts) : chaque mock refuse les routes,
// paramètres et corps absents du contrat amont et valide ses réponses de succès. Les erreurs ne sont pas typées
// par orval : toute réponse d'erreur simulée est marquée `outOfContract`. Chaque réponse du BFF est validée
// contre contracts/openapi.json. Le BFF n'a plus d'accès à PostgreSQL. Les corps simulés sont typés par les modèles
// générés et les chemins attendus viennent des helpers d'URL des clients générés.

const projectApi = new ContractMockServer('PROJECT_API', loadOrvalContract('@mairie360/project-api-openapi'));
const coreApi = new ContractMockServer('CORE_API', loadOrvalContract('@mairie360/core-api-openapi'));
const mocks = [projectApi, coreApi];
// Gabarits des contrats amont (clés des mocks) ; les chemins concrets attendus viennent des helpers d'URL.
const PROJECT = {
  projects: '/api/v1/projects/',
  project: '/api/v1/projects/{projectId}/',
  close: '/api/v1/projects/{projectId}/close',
  users: '/api/v1/projects/{projectId}/users/',
  user: '/api/v1/projects/{projectId}/users/{userId}/',
  tasks: '/api/v1/projects/{projectId}/tasks/',
  archivedTasks: '/api/v1/projects/{projectId}/archived-tasks/',
  task: '/api/v1/projects/{projectId}/tasks/{taskId}/',
  collaboration: '/api/v1/projects/{projectId}/tasks/{taskId}/collaboration',
  comments: '/api/v1/projects/{projectId}/tasks/{taskId}/comments',
  statuses: '/api/v1/projects/{projectId}/statuses/',
  status: '/api/v1/projects/{projectId}/statuses/{statusId}/',
  milestones: '/api/v1/projects/{projectId}/milestones/',
  milestone: '/api/v1/projects/{projectId}/milestones/{milestoneId}/',
  activity: '/api/v1/projects/{projectId}/activity/',
  projectComments: '/api/v1/projects/{projectId}/comments/',
  bulkDelete: '/api/v1/projects/bulk-delete/',
  templates: '/api/v1/project-templates/',
  template: '/api/v1/project-templates/{templateId}/',
  health: '/health',
} as const;
const CORE = { directory: '/api/v1/user/', me: '/api/v1/user/me/', health: '/health' } as const;
const bffContract = OpenApiContract.load(path.join(__dirname, '..', 'contracts', 'openapi.json'));

const { admin, alice, marie } = agents;

let app: Express;

beforeAll(async () => {
  await Promise.all(mocks.map((mock) => mock.start()));
  app = (await import('../src/app')).default;
});
afterAll(async () => { await Promise.all(mocks.map((mock) => mock.stop())); });

beforeEach(() => {
  for (const mock of mocks) mock.reset();
  captureLogs();
  // Every upstream URL (<SERVICE>_URL + <SERVICE>_PORT) is read again on every call.
  const coreApiUrl = new URL(coreApi.url);
  process.env.CORE_API_URL = coreApiUrl.hostname;
  process.env.CORE_API_PORT = coreApiUrl.port;
  const projectApiUrl = new URL(projectApi.url);
  process.env.PROJECT_API_URL = projectApiUrl.hostname;
  process.env.PROJECT_API_PORT = projectApiUrl.port;
  // Annuaire Core : la restriction par groupes est appliquée comme par Core API.
  coreApi.on('get', CORE.directory, ({ url }) => {
    const { group_ids }: Pick<ListDirectoryUsersParams, 'group_ids'> = Object.fromEntries(url.searchParams);
    const groupIds = group_ids?.split(',').map(Number);
    const directory = [admin, alice, marie];
    return {
      body: coreDirectory(groupIds ? directory.filter((agent) => agent.id !== admin.id) : directory),
    };
  });
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

/** Core `GET /api/v1/user/me/` answers the profile of `agent` (roles, groups, name). */
const signIn = (agent: Agent, reply: MockReply = { body: coreMe(agent) }) => coreApi.on('get', CORE.me, reply);
/** A token issued before the `role` claim (MAIR-529): the BFF reads the roles from Core. */
const as = (call: request.Test, agent: Agent) => call.set('Authorization', bearer(agent.id));
/** A token carrying `claims`, by default the agent's `role`: the BFF reads it, without calling Core (MAIR-525). */
const withClaims = (call: request.Test, agent: Agent, claims: object = { role: agent.role }) =>
  call.set('Authorization', bearer(agent.id, claims));
/** Appels reçus par Project API, sous la forme `MÉTHODE chemin` (chemin tel que le construit le client généré). */
const upstreamSequence = () => projectApi.requests.map((call) => `${call.method} ${call.url.pathname}`);
const called = (method: string, url: string) => `${method} ${url}`;
/** Project API writes the task history itself (database trigger): the BFF never posts to a `/history` path. */
const historyWrites = () => projectApi.requests.filter((call) => call.url.pathname.endsWith('/history'));
/** `limit` / `offset` query of a paginated Project API call, with Project API's defaults (100, 0). */
const pageOf = (url: URL) => ({ limit: Number(url.searchParams.get('limit') ?? 100), offset: Number(url.searchParams.get('offset') ?? 0) });
/** Erreur texte d'actix/mairie360_api_lib : non typée par orval, donc hors contrat. */
const textError = (status: number, raw: string): MockReply => ({ status, raw, contentType: 'text/plain', outOfContract: true });

type Scenario = {
  projects?: ProjectListItemView[];
  bundles?: Record<number, GetProjectResultView>;
  createdProjectId?: number;
  createdTaskId?: number;
};

function mockProjectApi({ projects = [], bundles = {}, createdProjectId = 12, createdTaskId = 30 }: Scenario = {}) {
  // The groups the caller may link: the BFF checks them before writing a group (create, duplicate, PATCH).
  projectApi.on('get', '/api/v1/project-groups/', { body: { groups: [{ id: 3, name: 'Roads' }, { id: 4, name: 'Administration' }, { id: 5, name: 'Green spaces' }] } });
  projectApi.on('get', PROJECT.projects, { body: projectsResult(projects) });
  projectApi.on('get', PROJECT.project, ({ pathParams }) => {
    const bundle = bundles[Number(pathParams.projectId)];
    // 404 renvoyé par Project API pour un projet inexistant ou invisible (erreurs non typées par orval).
    return bundle ? { body: bundle } : textError(404, 'Unknown project.');
  });
  projectApi.on('post', PROJECT.projects, { body: createProjectResult(createdProjectId) });
  projectApi.on('patch', PROJECT.project, { status: 204 });
  projectApi.on('patch', PROJECT.close, { status: 200 });
  projectApi.on('delete', PROJECT.project, { status: 204 });
  projectApi.on('get', PROJECT.users, ({ pathParams }) => ({ body: projectUsersResult(bundles[Number(pathParams.projectId)]?.users ?? []) }));
  projectApi.on('post', PROJECT.users, { status: 200 });
  // A responsible already member of the project is promoted to manager.
  projectApi.on('patch', PROJECT.user, { status: 204 });
  projectApi.on('delete', PROJECT.user, { status: 204 });
  projectApi.on('post', PROJECT.tasks, { body: createTaskResult(createdTaskId) });
  // GET …/tasks/{taskId}/: the task alone, 404 when the project or the task is unknown (MAIR-474).
  projectApi.on('get', PROJECT.task, ({ pathParams }) => {
    const task = bundles[Number(pathParams.projectId)]?.tasks.find((entry) => entry.id === Number(pathParams.taskId));
    return task ? { body: task } : textError(404, 'Unknown task.');
  });
  projectApi.on('patch', PROJECT.task, { status: 204 });
  projectApi.on('delete', PROJECT.task, { status: 204 });
}

describe('Project BFF with contract-driven Project API and Core API mocks', () => {
  test('every response carries the shared security headers and no X-Powered-By', async () => {
    const [api, docs, malformed] = await Promise.all([
      request(app).get('/health'),
      request(app).get('/docs/'),
      as(request(app).patch('/projects/project-1/close'), admin).set('Content-Type', 'application/json').send('{"status":'),
    ]);

    for (const response of [api, docs, malformed]) {
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    }
    // The JSON API surface (body-parse errors included) gets the strict API-only headers; /docs keeps the
    // shared policy its scripts and styles need.
    for (const response of [api, malformed]) {
      expect(response.headers['content-security-policy']).toBe("default-src 'none'");
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['permissions-policy']).toBe('geolocation=(), camera=(), microphone=()');
    }
    expect(docs.headers['content-security-policy']).toContain("default-src 'self'");
  });

  describe('session resolution through BFF User GET /me', () => {
    test('rejects project routes without a bearer before calling any upstream', async () => {
      const responses = await Promise.all([
        request(app).get('/projects-page'),
        request(app).get('/projects-page').set('Authorization', 'Basic YWRtaW46YWRtaW4='),
        request(app).get('/projects-page').set('Authorization', 'Bearer'),
        request(app).get('/projects-page').set('Authorization', 'Bearer two words'),
        // The access token is only read from the Authorization header: cookies and x-session-token are ignored.
        request(app).get('/projects-page').set('Cookie', 'accessToken=abc.def.ghi; session=abc.def.ghi'),
        request(app).get('/projects-page').set('x-session-token', 'abc.def.ghi'),
        request(app).post('/projects').send({}),
      ]);

      expect(responses.map((response) => [response.status, response.body.error.code])).toEqual(Array(7).fill([401, 'UNAUTHORIZED']));
      expect(responses.map((response) => response.headers['cache-control'])).toEqual(Array(7).fill('no-store'));
      responses.slice(0, 6).forEach((response) => expectBffContract('get', '/projects-page', response));
      expectBffContract('post', '/projects', responses[6]);
      expect(mocks.flatMap((mock) => mock.requests)).toEqual([]);
    });

    test('session-bound answers are never cached and the normalised Bearer header is forwarded', async () => {
      signIn(admin);
      mockProjectApi();

      const response = await request(app).get('/projects-page').set('Authorization', `  bearer   ${bearer(admin.id).slice('Bearer '.length)}  `);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(coreApi.calls(CORE.me, 'get')[0].headers.authorization).toBe(bearer(admin.id));
      expect(projectApi.calls(PROJECT.projects, 'get')[0].headers.authorization).toBe(bearer(admin.id));
      expect(coreApi.calls(CORE.directory, 'get')[0].headers.authorization).toBe(bearer(admin.id));
    });

    test('takes the caller id from the verified token', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id })], [alice]) } });

      const response = await as(request(app).get('/projects/project-1'), alice);

      expect(response.status).toBe(200);
      // The task assigned to the caller (id read from the sub of the verified token) is visible.
      expect(response.body.taskItems.map((task: { id: string }) => task.id)).toEqual(['task-2']);
    });

    test('answers 401 to an opaque token without any upstream call', async () => {
      signIn(alice);
      const opaque = await request(app).get('/projects-page').set('Authorization', 'Bearer opaque-token');

      expect(opaque.status).toBe(401);
      expect(mocks.flatMap((mock) => mock.requests)).toHaveLength(0);
    });

    test('reads the roles of an older token from Core and normalizes role aliases', async () => {
      signIn(marie, { body: coreMe(marie, { role: 'manager', roles: ['Utilisateur', 'ROLE_RESPONSABLE'] }) });
      mockProjectApi();

      const response = await as(request(app).get('/projects-page'), marie);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.access).toEqual({
        role: 'Responsable', scope: 'team', canCreateProject: true, canManageProjects: true, canManageTasks: true,
        canUpdateAssignedTaskStatus: true, canCommentTasks: true,
      });
      // One Core read serves the roles and the groups of the assignable users.
      const [me] = coreApi.calls(CORE.me, 'get');
      expect(coreApi.calls(CORE.me, 'get')).toHaveLength(1);
      expect(me.url.pathname).toBe(coreApiUrls.getGetMeUrl());
      expect(me.headers.authorization).toBe(bearer(marie.id));
      expect(projectApi.calls(PROJECT.projects, 'get')[0].headers.authorization).toBe(bearer(marie.id));
    });

    test('MAIR-525: reads the role in the token and never calls Core for it', async () => {
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const page = await withClaims(request(app).get('/projects-page'), admin, { role: 'admin' });
      const details = await withClaims(request(app).get('/projects/project-1'), admin, { role: 'admin' });

      expect(page.status).toBe(200);
      expect(page.body.access).toMatchObject({ role: 'Admin', scope: 'all' });
      expect(details.status).toBe(200);
      expect(coreApi.calls(CORE.me)).toHaveLength(0);
    });

    test('MAIR-525: a token whose role is unknown is a Guest, whatever Core says', async () => {
      signIn(admin);
      mockProjectApi();

      const response = await withClaims(request(app).get('/projects-page'), alice, { role: 'Visiteur' });

      expect(response.status).toBe(200);
      expect(response.body.access).toMatchObject({ role: 'Guest', canCreateProject: false });
    });

    test.each([
      ['an empty `role` claim', { role: '' }],
      ['only a `roles` claim (ignored)', { roles: ['admin'] }],
    ])('MAIR-529: a token with %s reads the role from Core', async (_label, claims) => {
      signIn(marie);
      mockProjectApi();

      const response = await withClaims(request(app).get('/projects-page'), alice, claims);

      expect(response.status).toBe(200);
      expect(response.body.access).toMatchObject({ role: 'Responsable' });
      expect(coreApi.calls(CORE.me, 'get').length).toBeGreaterThanOrEqual(1);
    });

    test('MAIR-525: a Responsable from the token reads Core once, for the groups of the assignable users', async () => {
      signIn(marie);
      mockProjectApi();

      const response = await withClaims(request(app).get('/projects-page'), marie);

      expect(response.status).toBe(200);
      expect(response.body.access).toMatchObject({ role: 'Responsable', scope: 'team' });
      expect(coreApi.calls(CORE.me, 'get')).toHaveLength(1);
      expect(coreApi.calls(CORE.directory, 'get')[0].url.searchParams.get('group_ids')).toBe('1');
    });

    test.each([
      ['a Core 500', { status: 500, raw: 'boom', contentType: 'text/plain', outOfContract: true }, 'Upstream service error'],
      ['a Core 403', { status: 403, raw: 'forbidden', contentType: 'text/plain', outOfContract: true }, 'Upstream service error'],
      ['an invalid JSON body', { raw: '<html>proxy</html>', contentType: 'text/html', outOfContract: true }, 'The CORE_API answer is invalid.'],
      ['a dropped connection', { dropConnection: true }, 'The CORE_API service is unavailable.'],
    ] as Array<[string, MockReply, string]>)('maps %s on the roles of an older token to 502 without leaking details', async (_label, reply, message) => {
      signIn(alice, reply);
      captureLogs();

      const response = await as(request(app).get('/projects-page'), alice);

      expect(response.status).toBe(502);
      expect(response.body.error).toEqual({ code: 'BAD_GATEWAY', message, details: [] });
      expect(projectApi.requests).toHaveLength(0);
    });

    test('propagates a Core 401 and an unreachable Core', async () => {
      signIn(alice, { status: 401, raw: 'Token expiré', contentType: 'text/plain', outOfContract: true });
      const refused = await as(request(app).get('/projects-page'), alice);

      process.env.CORE_API_PORT = new URL(await unreachableUrl()).port;
      captureLogs();
      const unreachable = await as(request(app).get('/projects-page'), alice);

      expect(refused.status).toBe(401);
      expect(refused.body.error).toEqual({ code: 'UNAUTHORIZED', message: 'Authentication required', details: [] });
      expect(unreachable.status).toBe(502);
      expect(unreachable.body.error.message).toBe('The CORE_API service is unavailable.');
    });
  });

  describe('archived tasks (MAIR-502)', () => {
    test('GET /projects/:id lists the active tasks and counts the archived ones as done', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [
        taskView(1, { status: 'InProgress' }),
      ], [admin], { tasks_archived: 3 }) } });

      const response = await as(request(app).get('/projects/project-1'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1', response);
      expect(response.body.taskItems.map((task: { id: string }) => task.id)).toEqual(['task-1']);
      // 3 archived (done) of 4 tasks; the active and archived counts tell them apart (MAIR-559).
      expect(response.body.project).toMatchObject({
        progress: 75, tasks: { total: 4, completed: 3, active: 1, archived: 3 },
      });
    });

    test('GET /projects/:id/archived-tasks pages the archived tasks Project API returns', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [admin, alice]) } });
      projectApi.on('get', PROJECT.archivedTasks, () => ({ body: {
        tasks: [taskView(7, { status: 'Completed', archived_at: '2026-10-02T14:30:00Z', assigned_to: alice.id })],
        total: 45,
      } }));

      const response = await as(request(app).get('/projects/project-1/archived-tasks?page=2&limit=20'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1/archived-tasks', response);
      expect(response.body.tasks).toEqual([expect.objectContaining({ id: 'task-7', status: 'done' })]);
      expect(response.body.pagination).toEqual({ page: 2, limit: 20, total: 45, hasNextPage: true });
      const [call] = projectApi.calls(PROJECT.archivedTasks, 'GET');
      expect(Object.fromEntries(call.url.searchParams)).toEqual({ limit: '20', offset: '20' });
    });

    test('GET /projects/:id/archived-tasks only shows an agent the tasks assigned to them', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice, marie]) } });
      projectApi.on('get', PROJECT.archivedTasks, { body: {
        tasks: [
          taskView(7, { status: 'Completed', archived_at: '2026-10-02T14:30:00Z', assigned_to: alice.id }),
          taskView(8, { status: 'Completed', archived_at: '2026-10-01T14:30:00Z', assigned_to: marie.id }),
        ],
        total: 2,
      } });

      const response = await as(request(app).get('/projects/project-1/archived-tasks'), alice);

      expect(response.status).toBe(200);
      expect(response.body.tasks.map((task: { id: string }) => task.id)).toEqual(['task-7']);
    });

    test('GET /projects/:id/archived-tasks answers 404 for a project out of sight', async () => {
      signIn(alice);
      mockProjectApi();
      projectApi.on('get', PROJECT.archivedTasks, textError(404, 'Not found.'));

      const response = await as(request(app).get('/projects/project-9/archived-tasks'), alice);

      expect(response.status).toBe(404);
      expectBffContract('get', '/projects/project-9/archived-tasks', response);
    });

    test.each(['page=0', 'limit=101', 'limit=abc'])('GET /projects/:id/archived-tasks refuses %s with 400', async (query) => {
      signIn(admin);
      mockProjectApi();

      const response = await as(request(app).get(`/projects/project-1/archived-tasks?${query}`), admin);

      expect(response.status).toBe(400);
      expect(projectApi.calls(PROJECT.archivedTasks, 'GET')).toHaveLength(0);
    });
  });

  describe('reads', () => {
    test('GET /projects-page builds the page from one Project API call, with its aggregates and counts', async () => {
      signIn(admin);
      const listed = projectListItem(1, {
        name: 'Rénovation de la médiathèque', tasks_total: 2, tasks_completed: 1, priority: 'High',
        due_date: '2026-10-15T00:00:00Z', members: [member(alice), member(marie)],
        members_total: 2,
      });
      mockProjectApi();
      projectApi.on('get', PROJECT.projects, { body: projectsResult([listed], 41, {
        by_status: { todo: 2, active: 30, review: 3, suspended: 6, completed: 4, other: 1 },
        by_priority: { low: 5, medium: 10, high: 26 },
      }) });

      const response = await as(request(app).get('/projects-page?q=%20m%C3%A9diath%C3%A8que%20&status=in-progress&priority=high&dueBefore=2026-12-31&limit=10&page=3&view=table'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.projects).toEqual([expect.objectContaining({
        id: 'project-1', title: 'Rénovation de la médiathèque', status: 'in-progress', priority: 'high',
        progress: 50, dueDate: '2026-10-15T00:00:00Z',
        responsible: { id: 'user-2', name: 'Alice Martin', avatarUrl: null },
        // The completed task is the archived one (MAIR-559).
        tasks: { total: 2, completed: 1, active: 1, archived: 1 },
        permissions: { canView: true, canEdit: true, canDuplicate: true, canDelete: true, canCreateTask: true, canAssignMembers: true, canClose: true },
      })]);
      // The counts cover every matching project, the Kanban columns list the ids of the page. `todo` adds the
      // statuses Project API does not interpret; the suspended projects are on hold (MAIR-1084).
      expect(response.body.summary).toEqual({
        totalProjects: 41,
        projectsByStatus: { todo: 3, 'in-progress': 30, review: 3, 'on-hold': 6, done: 4 },
        projectsByPriority: { high: 26, medium: 10, low: 5 },
      });
      expect(response.body.kanban.columns.map(({ status, count, projectIds }: { status: string; count: number; projectIds: string[] }) => [status, count, projectIds]))
        .toEqual([['todo', 3, []], ['in-progress', 30, ['project-1']], ['review', 3, []], ['on-hold', 6, []], ['done', 4, []]]);
      expect(response.body.pagination).toEqual({ page: 3, limit: 10, total: 41, hasNextPage: true });
      // Les membres proposés viennent de l'annuaire Core, pas des projets.
      expect(response.body.options.members.map((option: { value: string }) => option.value)).toEqual(['user-1', 'user-2', 'user-3']);
      // One Project API call carrying the filters and the page: no bundle is read.
      const [call] = projectApi.calls(PROJECT.projects, 'GET');
      expect(Object.fromEntries(call.url.searchParams)).toEqual({
        limit: '10', offset: '20', search: 'médiathèque', status: 'Active', priority: 'High',
        due_before: '2026-12-31T00:00:00.000Z',
      });
      expect(projectApi.calls(PROJECT.project, 'GET')).toHaveLength(0);
    });

    test.each([
      ['todo', { status: 'Todo' }],
      ['review', { status: 'Review' }],
      // MAIR-1084: the projects on hold have their own filter.
      ['on-hold', { status: 'Suspended' }],
      ['done', { status: 'Completed' }],
    ])('GET /projects-page sends the status %s as Project API\'s', async (status, expected) => {
      signIn(admin);
      mockProjectApi();

      const response = await as(request(app).get(`/projects-page?status=${status}&priority=all`), admin);

      expect(response.status).toBe(200);
      expect(Object.fromEntries(projectApi.calls(PROJECT.projects, 'GET')[0].url.searchParams)).toEqual({ limit: '10', offset: '0', ...expected });
    });

    test('GET /projects-page maps a project without task or member like the project detail does', async () => {
      signIn(admin);
      mockProjectApi({ projects: [projectListItem(4, { name: 'Vide', status: 'Error' })] });

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      const [project] = response.body.projects;
      expect(project).toMatchObject({ status: 'todo', priority: 'medium', progress: 0, tasks: { total: 0, completed: 0 } });
      // The project itself stands for the missing responsible.
      expect(project.responsible).toEqual({ id: 'project-4', name: 'Vide', avatarUrl: null });
      expect(project.assignees).toEqual([project.responsible]);
      expect(Number.isNaN(Date.parse(project.dueDate))).toBe(false);
    });

    // MAIR-536: page and limit are bounded integers; they were truncated or clamped silently (`limit=1e9`, `page=1.5`).
    test.each([
      ['page=0', 'page'], ['page=-1', 'page'], ['page=1.5', 'page'], ['page=abc', 'page'], ['page=10001', 'page'], ['page=1e12', 'page'],
      ['limit=0', 'limit'], ['limit=-5', 'limit'], ['limit=2.5', 'limit'], ['limit=501', 'limit'], ['limit=1e9', 'limit'],
    ])('GET /projects-page?%s answers 400 on %s without calling Project API', async (query, field) => {
      signIn(admin);
      mockProjectApi();

      const response = await as(request(app).get(`/projects-page?${query}`), admin);

      expect(response.status).toBe(400);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error.details).toEqual([expect.objectContaining({ path: `query.${field}` })]);
      expect(projectApi.requests).toHaveLength(0);
    });

    test.each([['page=1&limit=1', 0, 1], ['page=10000&limit=500', 4_999_500, 500]])(
      'GET /projects-page?%s accepts the bounds and sends offset %i, limit %i', async (query, offset, limit) => {
        signIn(admin);
        mockProjectApi();

        const response = await as(request(app).get(`/projects-page?${query}`), admin);

        expect(response.status).toBe(200);
        expect(projectApi.calls(PROJECT.projects, 'GET').map((call) => pageOf(call.url))).toEqual([{ limit, offset }]);
      });

    test.each([[500, 502], [503, 502], [401, 401]])('MAIR-536 GET /projects-page maps a Core API %i on the directory read to %i, without its body', async (coreStatus, status) => {
      signIn(admin);
      mockProjectApi();
      coreApi.on('get', CORE.directory, textError(coreStatus, 'Database error users'));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(status);
      expectBffContract('get', '/projects-page', response);
      expect(JSON.stringify(response.body)).not.toContain('Database error');
    });

    test('GET /projects-page refuses a search longer than Project API accepts without calling it', async () => {
      signIn(admin);
      mockProjectApi();

      const response = await as(request(app).get(`/projects-page?q=${'a'.repeat(256)}`), admin);

      expect(response.status).toBe(400);
      expectBffContract('get', '/projects-page', response);
      expect(projectApi.requests).toHaveLength(0);
    });

    test('GET /projects/:id returns the project an employee may see, with only their tasks', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [
        taskView(1, { assigned_to: marie.id }),
        taskView(2, { assigned_to: alice.id, status: 'InProgress' }),
      ], [alice, marie]) } });

      const response = await as(request(app).get('/projects/project-1'), alice);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1', response);
      expect(response.body.project.permissions.canEdit).toBe(false);
      expect(response.body.taskItems).toEqual([expect.objectContaining({
        id: 'task-2', status: 'in-progress',
        permissions: { canView: true, canEdit: false, canDelete: false, canUpdateStatus: true, canComment: true },
      })]);
    });

    test('GET /projects/:id answers 404 for a project Project API does not expose to the caller', async () => {
      signIn(alice);
      mockProjectApi();

      const response = await as(request(app).get('/projects/project-9'), alice);

      expect(response.status).toBe(404);
      expectBffContract('get', '/projects/project-9', response);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    test('GET /projects/:id/tasks/:taskId/collaboration returns the comments and history of Project API', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      const author = { id: 'user-2', name: 'Alice Martin' };
      projectApi.on('get', PROJECT.collaboration, { body: collaboration(
        [taskComment({ author })],
        [taskHistoryEntry({
          id: 'status-4', action: 'status_changed', label: 'Statut modifié : todo → in_progress',
          author, createdAt: '2026-09-02T08:00:00.000Z', changes: { status: { from: 'todo', to: 'in_progress' } },
        })],
      ) });

      const response = await as(request(app).get('/projects/project-1/tasks/task-2/collaboration'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1/tasks/task-2/collaboration', response);
      expect(response.body.comments[0].message).toBe('Devis reçu.');
      expect(response.body.history[0].action).toBe('status_changed');
    });

    test('GET /projects/:id reads every page of tasks and every member past the embedded ones', async () => {
      signIn(admin);
      const tasks = [taskView(1), taskView(2), taskView(3), taskView(4), taskView(5)];
      const users = [admin, alice, marie];
      mockProjectApi();
      projectApi.on('get', PROJECT.project, ({ url }) => {
        const { offset } = pageOf(url);
        // Two tasks per page, and only the first member embedded.
        return { body: projectBundle(projetView(1), tasks.slice(offset, offset + 2), users.slice(0, 1), { tasks_total: 5, users_total: 3 }) };
      });
      projectApi.on('get', PROJECT.users, ({ url }) => {
        const { offset } = pageOf(url);
        return { body: projectUsersResult(users.slice(offset, offset + 2).map((agent) => member(agent)), 3) };
      });

      const response = await as(request(app).get('/projects/project-1'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1', response);
      expect(response.body.taskItems.map((task: { id: string }) => task.id)).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5']);
      // The first page gives the totals, the others are read in parallel, stepping by the size served.
      expect(projectApi.calls(PROJECT.project, 'GET').map((call) => pageOf(call.url).offset).sort()).toEqual([0, 2, 4]);
      expect(projectApi.calls(PROJECT.users, 'GET').map((call) => pageOf(call.url).offset)).toEqual([0, 2]);
    });

    test('MAIR-525: reads the member pages after the first one in parallel, in a constant number of waves', async () => {
      signIn(admin);
      const users = Array.from({ length: 9 }, (_, i) => ({ id: 10 + i, name: `Agent ${i}`, role: 'contributor' as const }));
      mockProjectApi();
      projectApi.on('get', PROJECT.project, { body: projectBundle(projetView(1), [], [admin], { users_total: 9 }) });
      projectApi.on('get', PROJECT.users, ({ url }) => {
        const { offset } = pageOf(url);
        // Two members per page, slowly: pages read one after the other would never overlap.
        return { body: projectUsersResult(users.slice(offset, offset + 2), 9), delayMs: 30 };
      });

      const response = await as(request(app).get('/projects/project-1'), admin);

      expect(response.status).toBe(200);
      expect(projectApi.calls(PROJECT.users, 'GET').map((call) => pageOf(call.url).offset).sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8]);
      // Page 0 alone, then the four others together.
      expect(projectApi.maxInFlight).toBe(4);
    });

    // MAIR-502: the follow-up is paged, the most recent comments (kept in reading order) and history entries first.
    function mockCollaboration(commentCount: number, historyCount: number) {
      const comments = Array.from({ length: commentCount }, (_, i) => taskComment({ id: `comment-${i + 1}` }));
      const history = Array.from({ length: historyCount }, (_, i) => taskHistoryEntry({ id: `history-${historyCount - i}` }));
      projectApi.on('get', PROJECT.collaboration, ({ url }) => {
        const { limit, offset } = pageOf(url);
        // comments_order=latest pages the comments from the most recent one, like the history.
        const ordered = url.searchParams.get('comments_order') === 'latest' ? [...comments].reverse() : comments;
        return { body: collaboration(ordered.slice(offset, offset + limit), history.slice(offset, offset + limit), {
          comments_total: comments.length, history_total: history.length,
        }) };
      });
    }
    const idsOf = (entries: Array<{ id: string }>) => entries.map((entry) => entry.id);

    test('GET /projects/:id/tasks/:taskId/collaboration returns the most recent comments and history entries', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      mockCollaboration(5, 4);

      const response = await as(request(app).get('/projects/project-1/tasks/task-2/collaboration?limit=2'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1/tasks/task-2/collaboration', response);
      expect(idsOf(response.body.comments)).toEqual(['comment-4', 'comment-5']);
      expect(idsOf(response.body.history)).toEqual(['history-4', 'history-3']);
      expect(response.body.pagination).toEqual({ page: 1, limit: 2, commentsTotal: 5, historyTotal: 4, hasNextPage: true });
      // One read from the latest comment, never the whole feeds.
      const calls = projectApi.calls(PROJECT.collaboration, 'GET');
      expect(calls.map((call) => Object.fromEntries(call.url.searchParams))).toEqual([
        { limit: '2', offset: '0', comments_order: 'latest' },
      ]);
    });

    test('GET /projects/:id/tasks/:taskId/collaboration goes back in time page by page', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      mockCollaboration(5, 4);

      const page3 = await as(request(app).get('/projects/project-1/tasks/task-2/collaboration?limit=2&page=3'), admin);

      expect(page3.status).toBe(200);
      expect(idsOf(page3.body.comments)).toEqual(['comment-1']);
      expect(idsOf(page3.body.history)).toEqual([]);
      expect(page3.body.pagination.hasNextPage).toBe(false);
    });

    test('GET /projects/:id/tasks/:taskId/collaboration keeps every comment in reading order when they fit in a page', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      mockCollaboration(3, 1);

      const response = await as(request(app).get('/projects/project-1/tasks/task-2/collaboration'), admin);

      expect(idsOf(response.body.comments)).toEqual(['comment-1', 'comment-2', 'comment-3']);
      expect(response.body.pagination).toEqual({ page: 1, limit: 50, commentsTotal: 3, historyTotal: 1, hasNextPage: false });
      expect(projectApi.calls(PROJECT.collaboration, 'GET')).toHaveLength(1);
    });

    test.each(['page=0', 'limit=0', 'limit=101'])('GET /projects/:id/tasks/:taskId/collaboration refuses %s with 400', async (query) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const response = await as(request(app).get(`/projects/project-1/tasks/task-2/collaboration?${query}`), admin);

      expect(response.status).toBe(400);
      expect(projectApi.calls(PROJECT.collaboration, 'GET')).toHaveLength(0);
    });

    test('maps a Project API failure to 502 without leaking its body', async () => {
      signIn(admin);
      mockProjectApi();
      captureLogs();
      projectApi.on('get', PROJECT.projects, textError(500, 'An error occurred while accessing the database.'));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(502);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'BAD_GATEWAY', message: 'Upstream service error', details: [] });
      expect(JSON.stringify(response.body)).not.toContain('database');
    });

    test('mair_562 a persistent Project API 429 is answered 429 with Retry-After, not 502', async () => {
      signIn(admin);
      mockProjectApi();
      projectApi.on('get', PROJECT.projects, { ...textError(429, 'Too many requests'), headers: { 'Retry-After': '30' } });

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBe('30');
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    test('mair_562 every route answering 502 also declares the upstream 429 relayed by bffs-lib', () => {
      const document = JSON.parse(readFileSync(path.join(__dirname, '..', 'contracts', 'openapi.json'), 'utf8')) as {
        paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
      };
      const undeclared = Object.entries(document.paths)
        .filter(([route]) => route !== '/check_apis')
        .flatMap(([route, operations]) => Object.entries(operations).map(([method, operation]) => ({ route, method, responses: operation.responses ?? {} })))
        .filter(({ responses }) => '502' in responses && !('429' in responses))
        .map(({ method, route }) => `${method.toUpperCase()} ${route}`);

      expect(undeclared).toEqual([]);
    });

    test('retries an idempotent Project API read once after a transient failure', async () => {
      signIn(admin);
      mockProjectApi();
      let calls = 0;
      projectApi.on('get', PROJECT.projects, () => (++calls === 1
        ? { status: 503, raw: 'busy', contentType: 'text/plain', outOfContract: true }
        : { body: projectsResult([]) }));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(200);
      expect(projectApi.calls(PROJECT.projects, 'get')).toHaveLength(2);
    });

    test('never retries a write', async () => {
      signIn(admin);
      mockProjectApi();
      captureLogs();
      projectApi.on('post', PROJECT.projects, { status: 503, raw: 'busy', contentType: 'text/plain', outOfContract: true });

      const response = await as(request(app).post('/projects'), admin).send({
        title: 'Fête', description: 'Organisation', status: 'todo', priority: 'medium',
        responsibleId: '', assigneeIds: [], labels: [], dueDate: '2030-07-14T00:00:00Z', groupId: 'group-3',
      });

      expect(response.status).toBe(502);
      expectBffContract('post', '/projects', response);
      expect(projectApi.calls(PROJECT.projects, 'POST')).toHaveLength(1);
    });

    test.each([403, 404, 409, 501])('maps a Project API %i the route does not declare to 502', async (status) => {
      signIn(admin);
      mockProjectApi();
      projectApi.on('get', PROJECT.projects, textError(status, 'Project API internals'));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(502);
      expectBffContract('get', '/projects-page', response);
      expect(response.body).toEqual({ error: { code: 'BAD_GATEWAY', message: 'Upstream service error', details: [] } });
    });

    test('keeps a Project API 404 the route declares, with a generic message', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      projectApi.on('post', PROJECT.comments, textError(404, 'Unknown task 2.'));

      const response = await as(request(app).post('/projects/project-1/tasks/task-2/comments'), admin).send({ message: 'Devis reçu.' });

      expect(response.status).toBe(404);
      expectBffContract('post', '/projects/project-1/tasks/task-2/comments', response);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found', details: [] } });
    });

    test('answers a generic 500 when an unexpected error happens, without leaking it', async () => {
      signIn(admin);
      mockProjectApi();
      captureLogs();
      // A success body the mapping cannot read: the TypeError it raises must stay in the logs.
      projectApi.on('get', PROJECT.project, { body: { project: null, tasks: null, users: null }, outOfContract: true });

      const response = await as(request(app).get('/projects/project-1'), admin);

      expect(response.status).toBe(500);
      expectBffContract('get', '/projects/project-1', response);
      expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] } });
    });
  });

  describe('writes', () => {
    const createBody = {
      title: 'Fête du village', description: 'Organisation de la fête', status: 'todo', priority: 'medium',
      responsibleId: 'user-2', assigneeIds: ['user-3'], labels: ['événement'], dueDate: '2026-07-14T00:00:00Z', groupId: 'group-3',
      taskItems: [{ title: 'Réserver la salle', status: 'todo', priority: 'high', assigneeIds: [], labels: ['Urgent'], dueDate: '2026-06-25T00:00:00Z' }],
    };

    test('POST /projects creates the project, its members and its tasks through Project API', async () => {
      signIn(marie);
      mockProjectApi({ createdProjectId: 12, createdTaskId: 30, bundles: {
        12: projectBundle(projetView(12, { name: 'Fête du village' }), [taskView(30, { title: 'Réserver la salle' })], [alice, marie]),
      } });
      // Le projet vient d'être créé : Project API ne lui connaît encore aucun membre.
      projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

      const response = await as(request(app).post('/projects'), marie).send(createBody);

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects', response);
      // The chosen status and priority go with the creation (MAIR-558).
      expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toEqual({
        name: 'Fête du village', description: 'Organisation de la fête', status: 'Todo', priority: 'Medium', group_id: 3,
        // Project API records the responsible.
        responsible_id: alice.id,
      });
      // The responsible is written as a manager, the other members with Project API's default role.
      expect(projectApi.calls(PROJECT.users, 'POST').map((call) => call.body))
        .toEqual(expect.arrayContaining([{ user_id: alice.id, role: 'manager' }, { user_id: marie.id }]));
      expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ name: 'Réserver la salle' });
      expect(response.body.project.title).toBe('Fête du village');
    });

    test('PATCH /projects/:id updates the project through Project API and re-reads it', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { name: 'Voirie 2027' }), [], [marie]) } });

      const response = await as(request(app).patch('/projects/project-1'), marie).send({ title: 'Voirie 2027' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1', response);
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ name: 'Voirie 2027' });
      expect(response.body.project.title).toBe('Voirie 2027');
    });

    test.each([
      // MAIR-1084: `on-hold` suspends the project and reads back as on hold; `review` is the Review status.
      ['on-hold', 'Suspended', 'En pause'],
      ['review', 'Review', 'En revue'],
      ['done', 'Completed', 'Terminé'],
    ] as const)('PATCH /projects/:id/close with %s writes %s through Project API', async (status, stored, label) => {
      signIn(marie);
      // Starts in another status: the answer must be the re-read after the write, not the state before it.
      const bundle = projectBundle(projetView(1, { status: 'Active' }), [taskView(2)], [marie]);
      mockProjectApi({ bundles: { 1: bundle } });
      projectApi.on('patch', PROJECT.project, ({ body }) => {
        bundle.project = { ...bundle.project, status: (body as { status: typeof stored }).status };
        return { status: 204 };
      });

      const response = await as(request(app).patch('/projects/project-1/close'), marie).send({ status });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/close', response);
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ status: stored });
      expect(response.body.project).toMatchObject({ status, statusLabel: label });
    });

    test('MAIR-1085: the budget is read on the page and the detail, in cents of euro', async () => {
      signIn(admin);
      mockProjectApi({
        projects: [projectListItem(1, { budget_voted: 1_250_000, budget_committed: 430_000 }), projectListItem(2)],
        bundles: { 1: projectBundle(projetView(1, { budget_voted: 1_250_000, budget_committed: null }), [], [admin]) },
      });

      const page = await as(request(app).get('/projects-page'), admin);
      expect(page.status).toBe(200);
      expectBffContract('get', '/projects-page', page);
      expect(page.body.projects.map(({ budgetVoted, budgetCommitted }: Record<string, unknown>) => [budgetVoted, budgetCommitted]))
        .toEqual([[1_250_000, 430_000], [null, null]]);

      const detail = await as(request(app).get('/projects/project-1'), admin);
      expect(detail.status).toBe(200);
      expectBffContract('get', '/projects/project-1', detail);
      expect(detail.body.project).toMatchObject({ budgetVoted: 1_250_000, budgetCommitted: null });
    });

    test('MAIR-1085: PATCH keeps an absent budget, clears it with null and sets it in cents', async () => {
      signIn(marie);
      const bundle = projectBundle(projetView(1, { budget_voted: 500_000, budget_committed: 120_000 }), [], [marie]);
      mockProjectApi({ bundles: { 1: bundle } });
      // Applies each PATCH like Project API: an absent field keeps its value.
      projectApi.on('patch', PROJECT.project, ({ body }) => {
        const { name, ...rest } = body as { name?: string; budget_voted?: number | null; budget_committed?: number | null };
        bundle.project = { ...bundle.project, ...rest, ...(name !== undefined ? { name } : {}) };
        return { status: 204 };
      });

      const cleared = await as(request(app).patch('/projects/project-1'), marie).send({ budgetVoted: 900_000, budgetCommitted: null });
      const kept = await as(request(app).patch('/projects/project-1'), marie).send({ title: 'Voirie' });

      expect([cleared.status, kept.status]).toEqual([200, 200]);
      expectBffContract('patch', '/projects/project-1', cleared);
      expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([
        { budget_voted: 900_000, budget_committed: null },
        { name: 'Voirie' },
      ]);
      expect(cleared.body.project).toMatchObject({ budgetVoted: 900_000, budgetCommitted: null });
      // The title-only PATCH keeps both amounts, the cleared one included.
      expect(kept.body.project).toMatchObject({ title: 'Voirie', budgetVoted: 900_000, budgetCommitted: null });
    });

    test.each([
      ['a negative amount', { budgetVoted: -1 }, 'body.budgetVoted'],
      ['a fractional amount', { budgetCommitted: 12.5 }, 'body.budgetCommitted'],
      ['a text amount', { budgetVoted: '1000' }, 'body.budgetVoted'],
    ])('MAIR-1085: PATCH refuses %s with a 400 naming the field, before any write', async (_name, body, path) => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [marie]) } });

      const response = await as(request(app).patch('/projects/project-1'), marie).send(body);

      expect(response.status).toBe(400);
      expectBffContract('patch', '/projects/project-1', response);
      expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toEqual([]);
    });

    test('MAIR-1085: Project API refusing the budget answers its 400', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [marie]) } });
      projectApi.on('patch', PROJECT.project, textError(400, 'Invalid `budget_voted`: must be at least 0'));

      const response = await as(request(app).patch('/projects/project-1'), marie).send({ budgetVoted: 5 });

      expect(response.status).toBe(400);
      expectBffContract('patch', '/projects/project-1', response);
      // The 400 is Project API's: the BFF sent the PATCH once.
      expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([{ budget_voted: 5 }]);
      expect(JSON.stringify(response.body)).not.toContain('budget_voted');
    });

    test('MAIR-1085: a plain agent cannot set the budget', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { can_manage: false }), [], [alice]) } });

      const response = await as(request(app).patch('/projects/project-1'), alice).send({ budgetVoted: 5 });

      expect(response.status).toBe(403);
      expectBffContract('patch', '/projects/project-1', response);
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toEqual([]);
    });

    test('MAIR-1084: a project on hold is read, created and updated as on-hold', async () => {
      signIn(admin);
      const bundles = { 1: projectBundle(projetView(1, { status: 'Suspended' }), [], [admin]) };
      mockProjectApi({ bundles, projects: [projectListItem(1, { status: 'Suspended' })], createdProjectId: 1 });

      const page = await as(request(app).get('/projects-page'), admin);
      expect(page.status).toBe(200);
      expectBffContract('get', '/projects-page', page);
      expect(page.body.projects[0]).toMatchObject({ status: 'on-hold', statusLabel: 'En pause' });
      expect(page.body.summary.projectsByStatus['on-hold']).toBe(1);
      expect(page.body.kanban.columns.find((column: { status: string }) => column.status === 'on-hold'))
        .toEqual({ status: 'on-hold', label: 'En pause', projectIds: ['project-1'], count: 1 });
      expect(page.body.filters.statuses).toContainEqual({ label: 'En pause', value: 'on-hold' });

      const patched = await as(request(app).patch('/projects/project-1'), admin).send({ status: 'on-hold' });
      expect(patched.status).toBe(200);
      expectBffContract('patch', '/projects/project-1', patched);
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ status: 'Suspended' });
      expect(patched.body.project.status).toBe('on-hold');

      const created = await as(request(app).post('/projects'), admin).send({
        title: 'En attente', description: '', status: 'on-hold', priority: 'low', responsibleId: '', assigneeIds: [],
        labels: [], dueDate: '', groupId: 'group-3',
      });
      expect(created.status).toBe(201);
      expectBffContract('post', '/projects', created);
      expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ status: 'Suspended' });
    });

    test('PATCH /projects/:id/tasks/:taskId patches the task and leaves the history to Project API', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { title: 'Renommée' })], [marie]) } });

      const response = await as(request(app).patch('/projects/project-1/tasks/task-2'), marie).send({ title: 'Renommée' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/tasks/task-2', response);
      expect(projectApi.calls(PROJECT.task, 'PATCH')[0].body).toEqual({ name: 'Renommée' });
      expect(historyWrites()).toEqual([]);
    });

    describe('due date sent as a date alone (MAIR-559)', () => {
      const taskBody = {
        title: 'Réserver la salle', status: 'todo', priority: 'high',
        responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-11-05',
      };

      test('POST /projects/:id/tasks sends Project API midnight UTC of that day', async () => {
        signIn(marie);
        mockProjectApi({ createdTaskId: 30, bundles: { 1: projectBundle(projetView(1), [taskView(30, { title: 'Réserver la salle', assigned_to: alice.id })], [alice, marie]) } });

        const response = await as(request(app).post('/projects/project-1/tasks'), marie).send(taskBody);

        expect(response.status).toBe(201);
        expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ due_date: '2026-11-05T00:00:00.000Z' });
      });

      test('POST /projects converts the due date of its task items', async () => {
        signIn(marie);
        mockProjectApi({ createdProjectId: 12, createdTaskId: 30, bundles: { 12: projectBundle(projetView(12), [taskView(30)], [alice, marie]) } });
        projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

        const response = await as(request(app).post('/projects'), marie)
          .send({ ...createBody, dueDate: '2026-11-30', taskItems: [{ ...createBody.taskItems[0], dueDate: '2026-11-05' }] });

        expect(response.status).toBe(201);
        expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ due_date: '2026-11-05T00:00:00.000Z' });
      });

      test('PATCH /projects/:id/tasks/:taskId converts the date and leaves an empty one unchanged', async () => {
        signIn(marie);
        mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [marie]) } });

        const moved = await as(request(app).patch('/projects/project-1/tasks/task-2'), marie).send({ dueDate: '2026-12-01' });
        const cleared = await as(request(app).patch('/projects/project-1/tasks/task-2'), marie).send({ title: 'Salle', dueDate: '' });

        expect(moved.status).toBe(200);
        expect(cleared.status).toBe(200);
        expect(projectApi.calls(PROJECT.task, 'PATCH').map((call) => call.body)).toEqual([
          { due_date: '2026-12-01T00:00:00.000Z' },
          { name: 'Salle' },
        ]);
      });

      test.each(['05/11/2026', '2026-02-30', '2026-11-05T10:00', 'demain'])(
        'refuses the due date %s with a 400 before any write',
        async (dueDate) => {
          signIn(marie);
          mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [marie]) } });

          const created = await as(request(app).post('/projects/project-1/tasks'), marie).send({ ...taskBody, dueDate });
          const patched = await as(request(app).patch('/projects/project-1/tasks/task-2'), marie).send({ dueDate });

          expect(created.status).toBe(400);
          expect(patched.status).toBe(400);
          expect(projectApi.calls(PROJECT.tasks, 'POST')).toEqual([]);
          expect(projectApi.calls(PROJECT.task, 'PATCH')).toEqual([]);
        },
      );
    });

    // MAIR-560: Project API's 400 body is never relayed (a bare "Invalid request"), so the BFF refuses what Project API
    // would, naming the field, before any upstream call.
    describe('per-field validation errors (MAIR-560)', () => {
      const taskBody = {
        title: 'Réserver la salle', status: 'todo', priority: 'high',
        responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-11-05',
      };
      const upstreamWrites = () => [
        ...projectApi.calls(PROJECT.projects, 'POST'), ...projectApi.calls(PROJECT.project, 'PATCH'),
        ...projectApi.calls(PROJECT.tasks, 'POST'), ...projectApi.calls(PROJECT.task, 'PATCH'),
      ];
      const cases: Array<[string, 'post' | 'patch', string, Record<string, unknown>, string, string]> = [
        ['a blank project title', 'post', '/projects', { ...createBody, title: '   ' }, 'body.title', 'Must not be empty'],
        ['a 256-character project title', 'post', '/projects', { ...createBody, title: 'a'.repeat(256) }, 'body.title', 'Must be at most 255 characters'],
        ['a 5001-character description', 'post', '/projects', { ...createBody, description: 'a'.repeat(5_001) }, 'body.description', 'Must be at most 5000 characters'],
        ['a control character in a description', 'patch', '/projects/project-1', { description: 'a\u0000b' }, 'body.description', 'Must not contain control characters other than line breaks and tabs'],
        ['a line break in a project title', 'patch', '/projects/project-1', { title: 'Fête\ndu village' }, 'body.title', 'Must not contain line breaks or control characters'],
        ['a blank task title of a new project', 'post', '/projects', { ...createBody, taskItems: [{ ...createBody.taskItems[0], title: '' }] }, 'body.taskItems.0.title', 'Must not be empty'],
        ['a 256-character task label', 'post', '/projects/project-1/tasks', { ...taskBody, labels: ['ok', 'a'.repeat(256)] }, 'body.labels.1', 'Must be at most 255 characters'],
        ['the review task status', 'post', '/projects/project-1/tasks', { ...taskBody, status: 'review' }, 'body.status', 'review and on-hold are not available for tasks: use todo, in-progress or done, or a statusId of the project'],
        ['the review task status on update', 'patch', '/projects/project-1/tasks/task-2', { status: 'review' }, 'body.status', 'review and on-hold are not available for tasks: use todo, in-progress or done, or a statusId of the project'],
        ['the review task status of the status route', 'patch', '/projects/project-1/tasks/task-2/status', { status: 'review' }, 'body.status', 'review and on-hold are not available for tasks: use todo, in-progress or done, or a statusId of the project'],
        // MAIR-1084: `on-hold` is a project status only.
        ['the on-hold task status', 'post', '/projects/project-1/tasks', { ...taskBody, status: 'on-hold' }, 'body.status', 'review and on-hold are not available for tasks: use todo, in-progress or done, or a statusId of the project'],
        ['the on-hold task status of the status route', 'patch', '/projects/project-1/tasks/task-2/status', { status: 'on-hold' }, 'body.status', 'review and on-hold are not available for tasks: use todo, in-progress or done, or a statusId of the project'],
        ['an unknown task status', 'patch', '/projects/project-1/tasks/task-2', { status: 'blocked' }, 'body.status', ''],
        ['a malformed due date', 'patch', '/projects/project-1/tasks/task-2', { dueDate: '05/11/2026' }, 'body.dueDate', 'Expected a date (YYYY-MM-DD) or an ISO 8601 date-time'],
      ];

      test.each(cases)('refuses %s with a 400 naming the field, before any write', async (_label, method, url, body, path, message) => {
        signIn(marie);
        mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [marie]) } });

        const response = await as(request(app)[method](url), marie).send(body);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('BAD_REQUEST');
        const detail = response.body.error.details.find((item: { path?: string }) => item.path === path);
        expect(detail).toBeDefined();
        if (message) expect(detail.message).toBe(message);
        expect(upstreamWrites()).toEqual([]);
      });

      test('accepts 255 accented characters, line breaks in a description and < > free texts', async () => {
        signIn(marie);
        mockProjectApi({ createdTaskId: 30, bundles: { 1: projectBundle(projetView(1), [taskView(30)], [marie]) } });

        const created = await as(request(app).post('/projects/project-1/tasks'), marie)
          .send({ ...taskBody, title: 'é'.repeat(255), labels: ['Urgent'] });
        const patched = await as(request(app).patch('/projects/project-1'), marie)
          .send({ description: 'Première ligne\n\tseconde ligne' });

        expect(created.status).toBe(201);
        expect(patched.status).toBe(200);
      });
    });

    test('POST /projects/:id/tasks/:taskId/comments stores the comment through Project API', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id })], [alice]) } });
      projectApi.on('post', PROJECT.comments, { status: 201, body: taskComment({
        id: 'comment-9', message: 'Fait.', author: { id: `user-${alice.id}`, name: 'Alice Martin' }, createdAt: '2026-09-16T10:00:00.000Z',
      }) });

      const response = await as(request(app).post('/projects/project-1/tasks/task-2/comments'), alice).send({ message: 'Fait.' });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/tasks/task-2/comments', response);
      expect(projectApi.calls(PROJECT.comments, 'POST')[0].body).toEqual({ message: 'Fait.' });
      expect(response.body.message).toBe('Fait.');
    });

    test('POST /projects/:id/tasks creates the task and returns it from the re-read bundle', async () => {
      signIn(marie);
      mockProjectApi({ createdTaskId: 30, bundles: { 1: projectBundle(projetView(1), [taskView(30, { title: 'Réserver la salle', assigned_to: alice.id })], [alice, marie]) } });

      const response = await as(request(app).post('/projects/project-1/tasks'), marie).send({
        title: 'Réserver la salle', status: 'todo', priority: 'high',
        responsibleId: 'user-2', assigneeIds: ['user-2'], labels: ['Urgent'], dueDate: '2026-06-25T00:00:00Z',
      });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/tasks', response);
      expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ name: 'Réserver la salle' });
      expect(historyWrites()).toEqual([]);
      expect(response.body).toMatchObject({ id: 'task-30', title: 'Réserver la salle' });
    });

    test('POST /projects/:id/tasks answers 404 when the created task is missing from the bundle', async () => {
      signIn(marie);
      mockProjectApi({ createdTaskId: 99, bundles: { 1: projectBundle(projetView(1), [taskView(2)], [marie]) } });

      const response = await as(request(app).post('/projects/project-1/tasks'), marie).send({
        title: 'Fantôme', status: 'todo', priority: 'low', responsibleId: 'user-3', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z',
      });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    test('POST /projects/:id/duplicate recreates the project, its members and its tasks', async () => {
      signIn(marie);
      mockProjectApi({ createdProjectId: 12, bundles: {
        1: projectBundle(projetView(1, { name: 'Voirie', group: { id: 3, name: 'Roads' } }), [taskView(2, { title: 'Appel d\u2019offres' })], [alice, marie]),
        12: projectBundle(projetView(12, { name: 'Voirie' }), [taskView(30, { title: 'Appel d\u2019offres' })], [alice, marie]),
      } });
      // Le duplicata est vide tant que ses membres n'ont pas été ajoutés.
      projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

      const response = await as(request(app).post('/projects/project-1/duplicate'), marie).send({});

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/duplicate', response);
      expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ name: 'Voirie' });
      expect(projectApi.calls(PROJECT.users, 'POST').map((call) => call.body))
        .toEqual(expect.arrayContaining([{ user_id: alice.id }, { user_id: marie.id }]));
      expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ name: 'Appel d\u2019offres' });
      expect(response.body.taskItems).toHaveLength(1);
    });

    test('an unknown project answers 404 on every write route', async () => {
      signIn(marie);
      mockProjectApi();

      const responses = await Promise.all([
        as(request(app).patch('/projects/project-9'), marie).send({ title: 'Voirie' }),
        as(request(app).post('/projects/project-9/duplicate'), marie).send({}),
        as(request(app).delete('/projects/project-9'), marie),
        as(request(app).patch('/projects/project-9/tasks/task-2'), marie).send({ title: 'Renommée' }),
        as(request(app).get('/projects/project-9/tasks/task-2/collaboration'), marie),
      ]);

      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
      expect(projectApi.calls(PROJECT.project, 'DELETE')).toHaveLength(0);
    });

    test('DELETE removes a task and a project through Project API', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [marie]) } });

      const task = await as(request(app).delete('/projects/project-1/tasks/task-2'), marie);
      const project = await as(request(app).delete('/projects/project-1'), marie);

      expect([task.status, project.status]).toEqual([204, 204]);
      expectBffContract('delete', '/projects/project-1/tasks/task-2', task);
      expect(projectApi.calls(PROJECT.task, 'DELETE')).toHaveLength(1);
      expect(projectApi.calls(PROJECT.project, 'DELETE')).toHaveLength(1);
    });
  });

  describe('request validation and permissions', () => {
    test.each([
      ['get', '/projects-page?status=archived', undefined],
      ['post', '/projects', { title: 'Sans description' }],
      ['patch', '/projects/project-x', { title: 'Voirie' }],
      ['patch', '/projects/project-1/tasks/task-x', { title: 'Renommée' }],
      ['post', '/projects/project-1/tasks/task-2/comments', { message: '   ' }],
      ['post', '/projects/project-1/tasks/task-2/comments', { message: '<script>alert(1)</script>' }],
      ['patch', '/projects/project-1', { description: '<img src=x onerror=alert(1)>' }],
      ['patch', '/projects/project-1', { labels: ['<b>urgent</b>'] }],
      ['patch', '/projects/project-1/tasks/task-2', { responsibleId: '() { :;}; /bin/sleep 15' }],
      ['patch', '/projects/project-1/tasks/task-2', { assigneeIds: ['Jane Doe'] }],
      ['patch', '/projects/project-1/tasks/task-2', { assigneeIds: ['task-1'] }],
      ['get', '/projects-page?dueAfter=not-a-date', undefined],
    ] as const)('%s %s answers 400 without calling Project API', async (method, url, body) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const call = as(request(app)[method](url), admin);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(400);
      expectBffContract(method, url.split('?')[0], response);
      expect(response.body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Validation failed' });
      // Every detail names where the invalid value was read: body.<field>, params.<param> or query.<param>.
      expect(response.body.error.details.length).toBeGreaterThan(0);
      for (const detail of response.body.error.details) {
        expect(detail).toEqual({ path: expect.stringMatching(/^(body|params|query)(\.|$)/), message: expect.any(String) });
      }
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
    });

    test.each([
      ['get', '/projects/project-x', undefined],
      ['patch', '/projects/project-x/close', { status: 'done' }],
      ['delete', '/projects/project-x', undefined],
      ['post', '/projects/project-x/duplicate', {}],
      ['post', '/projects/project-x/tasks', { title: 'Réserver la salle', status: 'todo', priority: 'high', responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      ['delete', '/projects/project-1/tasks/task-x', undefined],
      ['patch', '/projects/project-1/tasks/task-x/status', { status: 'done' }],
      ['get', '/projects/project-1/tasks/task-x/collaboration', undefined],
      ['post', '/projects/project-1/tasks/task-x/comments', { message: 'Devis reçu.' }],
    ] as const)('%s %s answers 400 for an identifier without a numeric suffix', async (method, url, body) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const call = as(request(app)[method](url), admin);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(400);
      expectBffContract(method, url, response);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.details).toEqual([expect.objectContaining({ path: expect.stringMatching(/^params(\.|$)/) })]);
      expect(upstreamSequence()).toEqual([]);
    });

    test.each([
      ['get', '/projects/project-1', undefined],
      ['patch', '/projects/project-1', { title: 'Voirie' }],
      ['patch', '/projects/project-1/close', { status: 'done' }],
      ['delete', '/projects/project-1', undefined],
      ['post', '/projects/project-1/duplicate', {}],
      ['post', '/projects/project-1/tasks', { title: 'Réserver la salle', status: 'todo', priority: 'high', responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      ['patch', '/projects/project-1/tasks/task-2', { title: 'Renommée' }],
      ['delete', '/projects/project-1/tasks/task-2', undefined],
      ['patch', '/projects/project-1/tasks/task-2/status', { status: 'done' }],
      ['get', '/projects/project-1/tasks/task-2/collaboration', undefined],
    ] as const)('%s %s maps a Project API 500 to 502 without leaking it', async (method, url, body) => {
      signIn(admin);
      mockProjectApi();
      captureLogs();
      // The project guards read the project, the task guards the task alone (MAIR-474).
      projectApi.on('get', PROJECT.project, textError(500, 'An error occurred while accessing the database.'));
      projectApi.on('get', PROJECT.task, textError(500, 'An error occurred while accessing the database.'));

      const call = as(request(app)[method](url), admin);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(502);
      expectBffContract(method, url, response);
      expect(response.body).toEqual({ error: { code: 'BAD_GATEWAY', message: 'Upstream service error', details: [] } });
    });

    test('validation details point at the invalid fields', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const body = await as(request(app).post('/projects'), admin).send({ title: 'Sans description' });
      const params = await as(request(app).patch('/projects/project-x'), admin).send({ title: 'Voirie' });

      expect(body.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'body.description' })]));
      expect(params.body.error.details).toEqual([expect.objectContaining({ path: 'params.projectId' })]);
    });

    test('an unknown route answers the JSON 404 envelope', async () => {
      const response = await request(app).get('/unknown');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found', details: [] } });
    });

    test('a malformed JSON body answers a JSON 400, not the Express HTML error page', async () => {
      signIn(admin);

      const response = await as(request(app).patch('/projects/project-1/close'), admin)
        .set('Content-Type', 'application/json')
        .send('{"status":');

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid request', details: [] } });
    });

    test.each([
      ['patch', '/projects/project-1', { title: 'Voirie' }],
      ['post', '/projects/project-1/duplicate', {}],
      ['delete', '/projects/project-1', undefined],
      ['post', '/projects/project-1/tasks', { title: 'Réserver', status: 'todo', priority: 'high', responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
    ] as const)('%s %s answers 403 for an employee who may only read the project', async (method, url, body) => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [alice]) } });

      const call = as(request(app)[method](url), alice);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(403);
      expect(response.body.error).toMatchObject({ code: 'FORBIDDEN' });
    });

    test('an employee may update the status of their own task but not its content', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id })], [alice]) } });

      const status = await as(request(app).patch('/projects/project-1/tasks/task-2/status'), alice).send({ status: 'done' });
      const content = await as(request(app).patch('/projects/project-1/tasks/task-2'), alice).send({ title: 'Renommée' });

      expect(status.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/tasks/task-2/status', status);
      expect(projectApi.calls(PROJECT.task, 'PATCH')[0].body).toEqual({ status: 'Completed' });
      expect(content.status).toBe(403);
    });
  });

  // MAIR-536: the business 403s the table above does not cover, for an employee and for the roles no fixture used.
  describe('MAIR-536 business 403s by role', () => {
    const maire = { id: 4, first_name: 'Marc', last_name: 'Leroy', role: 'Maire' } as Agent;
    const guest = { id: 5, first_name: 'Gaelle', last_name: 'Invitee', role: 'Guest' } as Agent;
    const createBody = {
      title: 'Fête du village', description: 'Organisation', status: 'todo', priority: 'medium',
      responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-07-14T00:00:00Z', taskItems: [], groupId: 'group-3',
    };
    const someoneElsesTask = () => projectBundle(projetView(1), [taskView(2, { assigned_to: marie.id })], [alice, marie, guest]);

    test.each([
      ['an employee', alice],
      ['a guest', guest],
    ])('POST /projects answers 403 for %s without creating anything', async (_label, agent) => {
      signIn(agent);
      mockProjectApi({ bundles: { 1: someoneElsesTask() } });

      const response = await as(request(app).post('/projects'), agent).send(createBody);

      expect(response.status).toBe(403);
      expectBffContract('post', '/projects', response);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(projectApi.calls(PROJECT.projects, 'POST')).toHaveLength(0);
    });

    test('POST /projects lets the mayor create a project, like an administrator', async () => {
      signIn(maire);
      mockProjectApi({ createdProjectId: 12, bundles: { 12: projectBundle(projetView(12, { name: 'Fête du village' }), [], [alice]) } });
      projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

      const response = await as(request(app).post('/projects'), maire).send(createBody);

      expect(response.status).toBe(201);
      expect(projectApi.calls(PROJECT.projects, 'POST')).toHaveLength(1);
    });

    test.each([
      ['PATCH close by an employee', alice, 'patch', '/projects/project-1/close', { status: 'done' }],
      ['PATCH close by a guest', guest, 'patch', '/projects/project-1/close', { status: 'done' }],
      ['DELETE task by an employee', alice, 'delete', '/projects/project-1/tasks/task-2', undefined],
      ['DELETE task by a guest', guest, 'delete', '/projects/project-1/tasks/task-2', undefined],
    ] as const)('%s answers 403 and writes nothing', async (_label, agent, method, url, body) => {
      signIn(agent);
      // The task is the caller's own: they see it, so the refusal is a 403 (a task they cannot see is a 404).
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { assigned_to: agent.id })], [alice, marie, guest]) } });

      const call = as(request(app)[method](url), agent);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(projectApi.requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });

    test('a task status can only be changed by its assignee or a manager (requireTaskStatusUpdate)', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: someoneElsesTask() } });

      const refused = await as(request(app).patch('/projects/project-1/tasks/task-2/status'), alice).send({ status: 'done' });

      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toBe('Only the assigned agent or a manager can change this status.');
      expect(projectApi.calls(PROJECT.task, 'PATCH')).toHaveLength(0);

      signIn(maire);
      const allowed = await as(request(app).patch('/projects/project-1/tasks/task-2/status'), maire).send({ status: 'done' });
      expect(allowed.status).toBe(200);
      expect(projectApi.calls(PROJECT.task, 'PATCH')).toHaveLength(1);
    });

    test('DELETE of a task the caller cannot see is a 404, not a 403 that would confirm it exists', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: someoneElsesTask() } });

      const response = await as(request(app).delete('/projects/project-1/tasks/task-2'), alice);

      expect(response.status).toBe(404);
      expect(projectApi.requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });

    test('a comment is refused to someone who is neither assigned nor a manager (requireTaskComment)', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: someoneElsesTask() } });

      const refused = await as(request(app).post('/projects/project-1/tasks/task-2/comments'), alice).send({ message: 'Je passe par là.' });

      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toBe('You cannot comment on this task.');
      expect(projectApi.calls(PROJECT.comments, 'POST')).toHaveLength(0);
    });

    test('a manager can only assign agents of their team (requireAssignableUsers), the mayor anyone', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice, marie]) } });

      // user-99 is not in the directory the manager may assign from.
      const refused = await as(request(app).post('/projects/project-1/tasks'), marie).send({
        title: 'Réserver', status: 'todo', priority: 'high', responsibleId: 'user-99', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z',
      });

      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toBe('You can only assign agents of your team.');
      expect(projectApi.calls(PROJECT.tasks, 'POST')).toHaveLength(0);
    });
  });

  describe('MAIR-399 audit fixes', () => {
    const members = [alice, marie, admin];
    const memberUrl = (projectId: number, userId: number) => called('DELETE', projectApiUrls.getRemoveUserFromProjectUrl(projectId, userId));
    const removedMembers = () => projectApi.calls(PROJECT.user, 'DELETE').map((call) => `${call.method} ${call.url.pathname}`);
    const addedMembers = () => projectApi.calls(PROJECT.users, 'POST').map((call) => call.body);

    test('a PATCH with only responsibleId adds that member and removes nobody', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice, marie]) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ responsibleId: 'user-1' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1', response);
      expect(addedMembers()).toEqual([{ user_id: admin.id, role: 'manager' }]);
      expect(removedMembers()).toEqual([]);
      // The project record only gets its responsible.
      expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([{ responsible_id: admin.id }]);
    });

    test('a PATCH with only other fields leaves the members untouched', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], members) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ description: 'Nouvelle description' });

      expect(response.status).toBe(200);
      expect(addedMembers()).toEqual([]);
      expect(removedMembers()).toEqual([]);
    });

    test('a PATCH with assigneeIds rewrites the members from the merged state and keeps the current responsible', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], members) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ assigneeIds: [] });

      expect(response.status).toBe(200);
      // alice is the current responsible (first member): she stays, the others are removed.
      expect(removedMembers().sort()).toEqual([memberUrl(1, marie.id), memberUrl(1, admin.id)].sort());
      expect(addedMembers()).toEqual([]);
    });

    test('a PATCH with responsibleId and assigneeIds makes the members exactly that set', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice, marie]) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ responsibleId: 'user-1', assigneeIds: ['user-3'] });

      expect(response.status).toBe(200);
      expect(addedMembers()).toEqual([{ user_id: admin.id, role: 'manager' }]);
      expect(removedMembers()).toEqual([memberUrl(1, alice.id)]);
    });

    test('PATCH /projects/:id returns the re-read state, not the unpersisted submitted fields', async () => {
      signIn(admin);
      // The mock re-reads a Low / Active project whatever was written: the response is the re-read state.
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { priority: 'Low' }), [taskView(2, { priority: 'High', due_date: '2026-10-15T00:00:00.000Z' })], [admin]) } });

      const response = await as(request(app).patch('/projects/project-1'), admin)
        .send({ priority: 'high', labels: ['urgent'], dueDate: '2030-01-01T00:00:00Z', status: 'todo' });

      expect(response.status).toBe(200);
      // The priority is the project's stored one, not its tasks' highest (MAIR-558).
      expect(response.body.project).toMatchObject({
        priority: 'low', labels: [], dueDate: '2026-10-15T00:00:00.000Z', status: 'in-progress',
      });
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ status: 'Todo', priority: 'High' });
    });

    test.each([
      [{ priority: 'low' }, { priority: 'Low' }],
      [{ status: 'review' }, { status: 'Review' }],
      [{ status: 'in-progress', priority: 'medium' }, { status: 'Active', priority: 'Medium' }],
    ])('mair_558 PATCH /projects/:id stores %j as %j', async (sent, stored) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [admin]) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send(sent);

      expect(response.status).toBe(200);
      expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([stored]);
    });

    test('mair_558 a project created "to do" / "high" is read back as such', async () => {
      signIn(admin);
      mockProjectApi({ createdProjectId: 12, bundles: {
        12: projectBundle(projetView(12, { name: 'Fête', status: 'Todo', priority: 'High' }), [taskView(30, { priority: 'Low' })], [alice]),
      } });

      const response = await as(request(app).post('/projects'), admin).send({
        title: 'Fête', description: 'Organisation', status: 'todo', priority: 'high',
        responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2030-07-14T00:00:00Z', groupId: 'group-3',
      });

      expect(response.status).toBe(201);
      expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ status: 'Todo', priority: 'High' });
      // One write for the status and the priority: no PATCH after the creation.
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
      expect(response.body.project).toMatchObject({ status: 'todo', statusLabel: 'À faire', priority: 'high' });
    });

    test('POST /projects returns the re-read state and persists a closed status', async () => {
      signIn(admin);
      mockProjectApi({ createdProjectId: 12, bundles: {
        12: projectBundle(projetView(12, { name: 'Fête', status: 'Completed', priority: 'Low' }), [taskView(30, { priority: 'Low', status: 'Completed' })], [alice]),
      } });

      const response = await as(request(app).post('/projects'), admin).send({
        title: 'Fête', description: 'Organisation', status: 'done', priority: 'high',
        responsibleId: 'user-2', assigneeIds: [], labels: ['événement'], dueDate: '2030-07-14T00:00:00Z', groupId: 'group-3',
        taskItems: [{ title: 'Salle', status: 'done', priority: 'low', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects', response);
      // The status is written with the creation (MAIR-558), no longer by a PATCH after it.
      expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ status: 'Completed', priority: 'High' });
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
      expect(response.body.project).toMatchObject({ status: 'done', priority: 'low', labels: [], progress: 100 });
      expect(response.body.project.dueDate).not.toBe('2030-07-14T00:00:00Z');
    });

    test('POST /projects deletes the created project when a later step fails', async () => {
      signIn(admin);
      captureLogs();
      mockProjectApi({ createdProjectId: 12 });
      projectApi.on('post', PROJECT.tasks, textError(500, 'database is down'));

      const response = await as(request(app).post('/projects'), admin).send({
        title: 'Fête', description: 'Organisation', status: 'todo', priority: 'medium',
        responsibleId: '', assigneeIds: [], labels: [], dueDate: '2030-07-14T00:00:00Z', groupId: 'group-3',
        taskItems: [{ title: 'Salle', status: 'todo', priority: 'low', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      });

      expect(response.status).toBe(502);
      expectBffContract('post', '/projects', response);
      expect(upstreamSequence()).toEqual([
        called('POST', projectApiUrls.getCreateProjectUrl()),
        called('POST', projectApiUrls.getCreateTaskUrl(12)),
        called('DELETE', projectApiUrls.getDeleteProjectUrl(12)),
      ]);
    });

    test('POST /projects/:id/duplicate deletes the duplicate when a later step fails', async () => {
      signIn(admin);
      const logs = captureLogs();
      const stderr: string[] = [];
      jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      }) as typeof process.stderr.write);
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          stderr.push(args.map((arg) => (arg instanceof Error ? `${arg.stack} ${JSON.stringify(arg)}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
        });
      }
      mockProjectApi({ createdProjectId: 12, bundles: { 1: projectBundle(projetView(1, { group: { id: 3, name: 'Roads' } }), [taskView(2)], []) } });
      projectApi.on('post', PROJECT.tasks, textError(500, 'database is down'));
      projectApi.on('delete', PROJECT.project, textError(500, 'still down'));

      const response = await as(request(app).post('/projects/project-1/duplicate'), admin).send({});

      expect(response.status).toBe(502);
      expect(projectApi.calls(PROJECT.project, 'DELETE').map((call) => call.url.pathname)).toEqual([projectApiUrls.getDeleteProjectUrl(12)]);
      // The failed rollback is logged by the project id and a description of the error, never with the axios
      // error, which holds the caller's token and the request and response bodies (MAIR-290). Every line the BFF
      // writes is checked, the error handler's included.
      expect(logs).toEqual(expect.arrayContaining([
        expect.objectContaining({ level: 'ERROR', message: 'project rollback failed after a partial creation', project_id: 12 }),
      ]));
      const output = [JSON.stringify(logs), ...stderr].join('\n');
      expect(output).not.toContain(bearer(admin.id).slice('Bearer '.length));
      expect(output).not.toContain('still down');
      expect(output).not.toContain('database is down');
    });

    test('the access guards read the project bundle once per request, and a task guard only the task', async () => {
      signIn(admin);
      mockProjectApi({ createdProjectId: 12, bundles: {
        1: projectBundle(projetView(1, { group: { id: 3, name: 'Roads' } }), [taskView(2)], [admin]),
        12: projectBundle(projetView(12), [taskView(30)], [admin]),
      } });
      const reads = () => projectApi.calls(PROJECT.project, 'GET').length;

      await as(request(app).get('/projects/project-1'), admin);
      const details = reads();
      await as(request(app).patch('/projects/project-1'), admin).send({ title: 'Voirie' });
      const update = reads() - details;
      expect((await as(request(app).post('/projects/project-1/duplicate'), admin).send({})).status).toBe(201);
      const duplicate = reads() - details - update;
      await as(request(app).delete('/projects/project-1/tasks/task-2'), admin);
      const deleteTask = reads() - details - update - duplicate;
      await as(request(app).patch('/projects/project-1/tasks/task-2/status'), admin).send({ status: 'done' });
      const statusUpdate = reads() - details - update - duplicate - deleteTask;

      // details: guard only; update: guard + re-read; duplicate: guard + re-read of the copy; the task routes read
      // the task alone (MAIR-474), never the project with every task.
      expect({ details, update, duplicate, deleteTask, statusUpdate })
        .toEqual({ details: 1, update: 2, duplicate: 2, deleteTask: 0, statusUpdate: 0 });
      // delete: guard; status: guard + re-read of the task.
      expect(projectApi.calls(PROJECT.task, 'GET')).toHaveLength(3);
      // An older token: its roles come from Core, once per request.
      expect(coreApi.calls(CORE.me, 'get')).toHaveLength(5);
    });

    test.each([
      ['get', '/projects/user-1'],
      ['get', '/projects/abc1'],
      ['get', '/projects/project-1x'],
      ['delete', '/projects/project-1/tasks/project-2'],
      ['get', '/projects/task-1/tasks/task-2/collaboration'],
    ] as const)('%s %s answers 400: ids are parsed with their own prefix only', async (method, url) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const response = await as(request(app)[method](url), admin);

      expect(response.status).toBe(400);
      expectBffContract(method, url, response);
      expect(upstreamSequence()).toEqual([]);
    });

    test('an unknown task answers 404 from the guard without any write', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const response = await as(request(app).patch('/projects/project-1/tasks/task-9/status'), admin).send({ status: 'done' });

      expect(response.status).toBe(404);
      expectBffContract('patch', '/projects/project-1/tasks/task-9/status', response);
      expect(projectApi.calls(PROJECT.task, 'PATCH')).toHaveLength(0);
    });
  });

  describe('upstream configuration', () => {
    test.each([
      ['PROJECT_API', () => projectApi.requests],
      ['CORE_API', () => coreApi.requests],
    ] as const)('answers 503 without any call to %s when its URL is missing (no localhost default)', async (service, received) => {
      signIn(marie);
      mockProjectApi({ projects: [projectListItem(1)], bundles: { 1: projectBundle(projetView(1), [], [marie]) } });
      captureLogs();
      delete process.env[`${service}_URL`];
      delete process.env[`${service}_PORT`];

      const response = await as(request(app).get('/projects-page'), marie);

      expect(response.status).toBe(503);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: `The ${service} service is not configured.`, details: [] });
      expect(received()).toEqual([]);
    });

    test('a write route declares and answers 503 when Project API is not configured', async () => {
      signIn(marie);
      captureLogs();
      delete process.env.PROJECT_API_URL;

      const response = await as(request(app).patch('/projects/project-1/close'), marie).send({ status: 'done' });

      expect(response.status).toBe(503);
      expectBffContract('patch', '/projects/project-1/close', response);
      expect(projectApi.requests).toEqual([]);
    });

    test('a URL carrying its own port wins over <SERVICE>_PORT', async () => {
      signIn(admin);
      mockProjectApi();
      process.env.PROJECT_API_URL = projectApi.url;
      process.env.PROJECT_API_PORT = '1';

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(200);
      expect(projectApi.requests).toHaveLength(1);
    });
  });

  describe('GET /check_apis', () => {
    beforeEach(() => {
      projectApi.on('get', PROJECT.health, { raw: 'OK', contentType: 'text/plain' });
      coreApi.on('get', CORE.health, { raw: 'OK', contentType: 'text/plain' });
      captureLogs();
    });

    test('reports every upstream connected through its /health operation', async () => {
      // A public probe: the caller's Authorization header is never forwarded upstream.
      const response = await request(app).get('/check_apis').set('Authorization', bearer(admin.id));

      expect(response.status).toBe(200);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'OK', core_api: 'Connected', project_api: 'Connected' });
      expect(upstreamSequence()).toEqual([called('GET', projectApiUrls.getHealthUrl())]);
      expect(coreApi.requests.map((call) => call.url.pathname)).toEqual([coreApiUrls.getHealthUrl()]);
      expect(mocks.flatMap((mock) => mock.requests).map((call) => call.headers.authorization)).toEqual([undefined, undefined]);
      expect(response.headers['cache-control']).toBeUndefined();
    });

    test.each([
      ['Project API', () => projectApi.on('get', PROJECT.health, { dropConnection: true }), { core_api: 'Connected', project_api: 'Unreachable' }],
      ['Core API', () => coreApi.on('get', CORE.health, { dropConnection: true }), { core_api: 'Unreachable', project_api: 'Connected' }],
    ])('answers 502 when %s is unreachable', async (_service, breakService, expected) => {
      breakService();

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(502);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'Error', ...expected });
    });

    test('reports an unconfigured API as unreachable, probing the same variables as the real calls', async () => {
      delete process.env.PROJECT_API_URL;

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(502);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'Error', core_api: 'Connected', project_api: 'Unreachable' });
      expect(projectApi.requests).toEqual([]);
    });

    test('accepts a PROJECT_API_URL that already carries its port (as the Helm chart sets it)', async () => {
      process.env.PROJECT_API_URL = projectApi.url;
      delete process.env.PROJECT_API_PORT;

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'OK', core_api: 'Connected', project_api: 'Connected' });
    });
  });
});

describe('MAIR-566 per-project task statuses and project templates', () => {
  const statusView = (id: number, name: string, category: 'Todo' | 'InProgress' | 'Completed', position: number, task_count = 0) =>
    ({ id, name, color: '#64748B', category, position, task_count });
  const projectStatuses = [
    statusView(32, 'Terminé', 'Completed', 3, 5),
    statusView(30, 'À faire', 'Todo', 0, 2),
    statusView(31, 'En cours', 'InProgress', 1, 1),
    statusView(33, 'À valider', 'InProgress', 2, 0),
  ];
  const template = (id: number, overrides: object = {}) => ({
    id, name: `Modèle ${id}`, description: null, is_default: false, can_manage: false, custom_fields: [],
    statuses: [
      { name: 'Terminé', color: '#16A34A', category: 'Completed', position: 2 },
      { name: 'À faire', color: '#64748B', category: 'Todo', position: 0 },
      { name: 'En cours', color: '#2563EB', category: 'InProgress', position: 1 },
    ],
    ...overrides,
  });
  const writes = () => projectApi.requests.filter((call) => call.method !== 'GET');

  function mockStatuses() {
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(5, { status_id: 33, status_name: 'À valider', status: 'InProgress' })], [admin, alice]) } });
    projectApi.on('get', PROJECT.statuses, ({ pathParams }) => (Number(pathParams.projectId) === 1
      ? { body: { statuses: projectStatuses } }
      : textError(404, 'Not found.')));
    projectApi.on('post', PROJECT.statuses, { body: { status_id: 34 } });
    projectApi.on('patch', PROJECT.status, { status: 204 });
    projectApi.on('delete', PROJECT.status, { status: 204 });
    projectApi.on('get', PROJECT.templates, { body: { templates: [template(1, { name: 'Simple', is_default: true }), template(2)] } });
    projectApi.on('get', PROJECT.template, ({ pathParams }) => ({ body: template(Number(pathParams.templateId)) }));
    projectApi.on('post', PROJECT.templates, { body: { template_id: 7 } });
    projectApi.on('patch', PROJECT.template, { status: 204 });
    projectApi.on('delete', PROJECT.template, { status: 204 });
  }

  test('GET /projects/:id/statuses lists the statuses by position with their category', async () => {
    signIn(alice);
    mockStatuses();

    const response = await as(request(app).get('/projects/project-1/statuses'), alice);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects/project-1/statuses', response);
    expect(response.body.statuses.map((status: { id: string; name: string; category: string; taskCount: number }) =>
      [status.id, status.name, status.category, status.taskCount])).toEqual([
      ['status-30', 'À faire', 'todo', 2],
      ['status-31', 'En cours', 'in-progress', 1],
      ['status-33', 'À valider', 'in-progress', 0],
      ['status-32', 'Terminé', 'done', 5],
    ]);
  });

  test('GET /projects/:id/statuses is a 404 for an invisible project, without reading its statuses', async () => {
    signIn(alice);
    mockStatuses();

    const response = await as(request(app).get('/projects/project-9/statuses'), alice);

    expect(response.status).toBe(404);
    expect(projectApi.calls(PROJECT.statuses, 'GET')).toHaveLength(0);
  });

  test('mair_566 a manager adds, renames and deletes statuses; the answer is the re-read list', async () => {
    signIn(admin);
    mockStatuses();

    const created = await as(request(app).post('/projects/project-1/statuses'), admin)
      .send({ name: 'À valider', color: '#D97706', category: 'in-progress', position: 2 });
    const renamed = await as(request(app).patch('/projects/project-1/statuses/status-33'), admin)
      .send({ name: 'Relecture', category: 'done' });
    const deleted = await as(request(app).delete('/projects/project-1/statuses/status-33?moveTo=status-31'), admin);

    expect([created.status, renamed.status, deleted.status]).toEqual([201, 200, 200]);
    expectBffContract('post', '/projects/project-1/statuses', created);
    expectBffContract('delete', '/projects/project-1/statuses/status-33', deleted);
    expect(projectApi.calls(PROJECT.statuses, 'POST')[0].body).toEqual({ name: 'À valider', color: '#D97706', category: 'InProgress', position: 2 });
    expect(projectApi.calls(PROJECT.status, 'PATCH')[0].body).toEqual({ name: 'Relecture', category: 'Completed' });
    const [deletion] = projectApi.calls(PROJECT.status, 'DELETE');
    expect(deletion.url.pathname).toBe('/api/v1/projects/1/statuses/33/');
    expect(deletion.url.searchParams.get('move_to')).toBe('31');
    expect(created.body.statuses).toHaveLength(4);
  });

  test('mair_566 a user who cannot manage the project changes no status', async () => {
    signIn(alice);
    mockStatuses();

    const responses = await Promise.all([
      as(request(app).post('/projects/project-1/statuses'), alice).send({ name: 'X', category: 'todo' }),
      as(request(app).patch('/projects/project-1/statuses/status-30'), alice).send({ name: 'Y' }),
      as(request(app).delete('/projects/project-1/statuses/status-30'), alice),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(writes()).toEqual([]);
  });

  test('mair_566 deleting a status that holds tasks without moveTo relays Project API\'s 409', async () => {
    signIn(admin);
    mockStatuses();
    projectApi.on('delete', PROJECT.status, textError(409, 'The status holds tasks: give `move_to`, the status to move them to.'));

    const response = await as(request(app).delete('/projects/project-1/statuses/status-30'), admin);

    expect(response.status).toBe(409);
    expectBffContract('delete', '/projects/project-1/statuses/status-30', response);
  });

  test.each([
    ['post', '/projects/project-1/statuses', { name: 'X', category: 'review' }],
    ['post', '/projects/project-1/statuses', { name: 'X', category: 'todo', color: 'red' }],
    ['post', '/projects/project-1/statuses', { name: '<b>X</b>', category: 'todo' }],
    ['patch', '/projects/project-1/statuses/status-30', { unknown: true }],
    ['delete', '/projects/project-1/statuses/status-30?moveTo=31', undefined],
  ] as const)('mair_566 %s %s refuses an invalid request before any write (%#)', async (method, url, body) => {
    signIn(admin);
    mockStatuses();

    const call = as(request(app)[method](url), admin);
    const response = await (body ? call.send(body) : call);

    expect(response.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  test('GET /project-templates maps the templates and their statuses by position', async () => {
    signIn(alice);
    mockStatuses();

    const response = await as(request(app).get('/project-templates'), alice);

    expect(response.status).toBe(200);
    expectBffContract('get', '/project-templates', response);
    expect(response.body.templates[0]).toEqual({
      id: 'template-1', name: 'Simple', description: null, isDefault: true, canManage: false, customFields: [],
      statuses: [
        { name: 'À faire', color: '#64748B', category: 'todo', position: 0 },
        { name: 'En cours', color: '#2563EB', category: 'in-progress', position: 1 },
        { name: 'Terminé', color: '#16A34A', category: 'done', position: 2 },
      ],
    });
  });

  test('mair_566 only the Responsable and Admin roles manage templates', async () => {
    mockStatuses();
    const body = { name: 'Atelier', statuses: [{ name: 'Idée', category: 'todo' }, { name: 'Fait', category: 'done' }] };

    signIn(alice);
    const refused = await Promise.all([
      as(request(app).post('/project-templates'), alice).send(body),
      as(request(app).patch('/project-templates/template-2'), alice).send({ name: 'Autre' }),
      as(request(app).delete('/project-templates/template-2'), alice),
    ]);
    expect(refused.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(writes()).toEqual([]);

    signIn(marie);
    const created = await as(request(app).post('/project-templates'), marie).send(body);
    expect(created.status).toBe(201);
    expectBffContract('post', '/project-templates', created);
    expect(projectApi.calls(PROJECT.templates, 'POST')[0].body).toEqual({
      name: 'Atelier', description: null, custom_fields: [],
      statuses: [{ name: 'Idée', category: 'Todo' }, { name: 'Fait', category: 'Completed' }],
    });
    expect(created.body.id).toBe('template-7');
  });

  test('mair_691 each template tells the caller whether it may modify or delete it', async () => {
    signIn(marie);
    mockStatuses();
    projectApi.on('get', PROJECT.templates, { body: { templates: [
      template(1, { name: 'Simple', is_default: true }), template(2, { can_manage: true }), template(3),
    ] } });

    const list = await as(request(app).get('/project-templates'), marie);
    expect(list.status).toBe(200);
    expectBffContract('get', '/project-templates', list);
    expect(list.body.templates.map((item: { id: string; canManage: boolean }) => [item.id, item.canManage]))
      .toEqual([['template-1', false], ['template-2', true], ['template-3', false]]);
  });

  test('mair_691 a Responsable who did not create the template gets Project API\'s 403 on update and delete', async () => {
    signIn(marie);
    mockStatuses();
    projectApi.on('patch', PROJECT.template, textError(403, 'Forbidden.'));
    projectApi.on('delete', PROJECT.template, textError(403, 'Forbidden.'));

    const updated = await as(request(app).patch('/project-templates/template-2'), marie).send({ name: 'Autre' });
    const deleted = await as(request(app).delete('/project-templates/template-2'), marie);

    expect([updated.status, deleted.status]).toEqual([403, 403]);
    expectBffContract('patch', '/project-templates/template-2', updated);
    expectBffContract('delete', '/project-templates/template-2', deleted);
    expect(projectApi.calls(PROJECT.template, 'PATCH')).toHaveLength(1);
    expect(projectApi.calls(PROJECT.template, 'DELETE')).toHaveLength(1);
  });

  test('mair_566 deleting the default template relays Project API\'s 409', async () => {
    signIn(admin);
    mockStatuses();
    projectApi.on('delete', PROJECT.template, textError(409, 'The default template cannot be deleted.'));

    const response = await as(request(app).delete('/project-templates/template-1'), admin);

    expect(response.status).toBe(409);
    expectBffContract('delete', '/project-templates/template-1', response);
  });

  test('mair_566 a project is created from the chosen template', async () => {
    signIn(admin);
    mockProjectApi({ createdProjectId: 12, bundles: { 12: projectBundle(projetView(12), [], [alice]) } });

    const response = await as(request(app).post('/projects'), admin).send({
      title: 'Marché', description: 'Travaux', status: 'todo', priority: 'medium', templateId: 'template-3',
      responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2030-07-14T00:00:00Z', groupId: 'group-3',
    });

    expect(response.status).toBe(201);
    expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ template_id: 3 });
  });

  test('mair_566 a task is created in, moved to and shown with a status of its project', async () => {
    signIn(admin);
    mockStatuses();
    projectApi.on('post', PROJECT.tasks, { body: createTaskResult(5) });

    const created = await as(request(app).post('/projects/project-1/tasks'), admin).send({
      title: 'Relire', status: 'in-progress', statusId: 'status-33', priority: 'medium',
      responsibleId: '', assigneeIds: [], labels: [], dueDate: '2030-07-14',
    });
    const moved = await as(request(app).patch('/projects/project-1/tasks/task-5/status'), admin).send({ statusId: 'status-33' });
    const byCategory = await as(request(app).patch('/projects/project-1/tasks/task-5/status'), admin).send({ status: 'done' });

    expect([created.status, moved.status, byCategory.status]).toEqual([201, 200, 200]);
    expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ status_id: 33 });
    expect(projectApi.calls(PROJECT.task, 'PATCH').map((call) => call.body)).toEqual([{ status_id: 33 }, { status: 'Completed' }]);
    expect(moved.body).toMatchObject({ status: 'in-progress', statusId: 'status-33', statusName: 'À valider' });
    expectBffContract('patch', '/projects/project-1/tasks/task-5/status', moved);
  });

  test.each([
    [{ statusId: '33' }],
    [{}],
  ])('mair_566 the status route refuses %j before any write', async (body) => {
    signIn(admin);
    mockStatuses();

    const response = await as(request(app).patch('/projects/project-1/tasks/task-5/status'), admin).send(body);

    expect(response.status).toBe(400);
    expect(writes()).toEqual([]);
  });
});

describe('MAIR-683 project linked to a group', () => {
  const GROUPS = '/api/v1/project-groups/';
  const createBody = {
    title: 'Réfection de la place', description: 'Travaux 2027', status: 'todo', priority: 'medium',
    responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2027-06-30T00:00:00Z',
  };

  test('GET /project-groups lists the linkable groups with group-<id> ids', async () => {
    signIn(marie);
    projectApi.on('get', GROUPS, { body: { groups: [{ id: 5, name: 'Green spaces' }, { id: 3, name: 'Roads' }] } });

    const response = await as(request(app).get('/project-groups'), marie);

    expect(response.status).toBe(200);
    expectBffContract('get', '/project-groups', response);
    expect(response.body).toEqual({ groups: [{ id: 'group-5', name: 'Green spaces' }, { id: 'group-3', name: 'Roads' }] });
  });

  const WITHOUT_GROUP = '/api/v1/project-groups/projects-without-group/';

  test('mair_683 GET /project-groups/projects-without-group lists them with project ids for the administration', async () => {
    signIn(admin);
    projectApi.on('get', WITHOUT_GROUP, { body: { projects: [
      { id: 9, name: 'LED street lighting', created_at: '2026-03-03T09:12:00+00:00' },
      { id: 4, name: 'Gymnasium', created_at: null },
    ] } });

    const response = await as(request(app).get('/project-groups/projects-without-group'), admin);

    expect(response.status).toBe(200);
    expectBffContract('get', '/project-groups/projects-without-group', response);
    expect(response.body).toEqual({ projects: [
      { id: 'project-9', title: 'LED street lighting', createdAt: '2026-03-03T09:12:00+00:00' },
      { id: 'project-4', title: 'Gymnasium', createdAt: null },
    ] });
  });

  test('mair_683 GET /project-groups/projects-without-group relays the 403 of a caller outside Admin and Maire', async () => {
    signIn(marie);
    projectApi.on('get', WITHOUT_GROUP, textError(403, 'Forbidden.'));

    const response = await as(request(app).get('/project-groups/projects-without-group'), marie);

    expect(response.status).toBe(403);
    expectBffContract('get', '/project-groups/projects-without-group', response);
    expect(projectApi.calls(WITHOUT_GROUP, 'GET')).toHaveLength(1);
  });

  test('mair_683 GET /project-groups/projects-without-group refuses a call without session before any upstream call', async () => {
    const response = await request(app).get('/project-groups/projects-without-group');

    expect(response.status).toBe(401);
    expect(projectApi.requests).toEqual([]);
  });

  test('GET /project-groups refuses a call without session before any upstream call', async () => {
    const response = await request(app).get('/project-groups');

    expect(response.status).toBe(401);
    expect(projectApi.requests).toEqual([]);
    expect(coreApi.requests).toEqual([]);
  });

  test('POST /projects sends the group to Project API and returns it with the project', async () => {
    signIn(marie);
    mockProjectApi({ createdProjectId: 12, bundles: {
      12: projectBundle(projetView(12, { name: 'Réfection de la place', group: { id: 3, name: 'Roads' } }), [], [alice]),
    } });
    projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

    const response = await as(request(app).post('/projects'), marie).send({ ...createBody, groupId: 'group-3' });

    expect(response.status).toBe(201);
    expectBffContract('post', '/projects', response);
    expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ group_id: 3 });
    expect(response.body.project.group).toEqual({ id: 'group-3', name: 'Roads' });
  });

  test('POST /projects with a group the caller may not link answers 404 and writes nothing more', async () => {
    signIn(marie);
    mockProjectApi();
    projectApi.on('post', PROJECT.projects, textError(404, 'Group not found.'));

    const response = await as(request(app).post('/projects'), marie).send({ ...createBody, groupId: 'group-99' });

    expect(response.status).toBe(404);
    expectBffContract('post', '/projects', response);
    expect(response.body.error.code).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('Group not found');
    expect(projectApi.calls(PROJECT.users, 'POST')).toEqual([]);
    expect(projectApi.calls(PROJECT.project, 'DELETE')).toEqual([]);
  });

  test('POST /projects refuses a malformed groupId before any upstream call', async () => {
    signIn(marie);
    mockProjectApi();

    const response = await as(request(app).post('/projects'), marie).send({ ...createBody, groupId: '3' });

    expect(response.status).toBe(400);
    expectBffContract('post', '/projects', response);
    expect(projectApi.calls(PROJECT.projects, 'POST')).toEqual([]);
  });

  test('PATCH /projects/:id changes the group and keeps it when absent', async () => {
    signIn(marie);
    const patchAs = async (body: object, group: { id: number; name: string }) => {
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { group }), [], [marie]) } });
      const response = await as(request(app).patch('/projects/project-1'), marie).send(body);
      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1', response);
      return response;
    };

    const changed = await patchAs({ groupId: 'group-5' }, { id: 5, name: 'Green spaces' });
    const kept = await patchAs({ title: 'Renommé' }, { id: 5, name: 'Green spaces' });

    expect(changed.body.project.group).toEqual({ id: 'group-5', name: 'Green spaces' });
    expect(kept.body.project.group).toEqual({ id: 'group-5', name: 'Green spaces' });
    expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([
      { group_id: 5 }, { name: 'Renommé' },
    ]);
  });

  test('mair_683 PATCH /projects/:id refuses to remove the group and writes nothing', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { group: { id: 3, name: 'Roads' } }), [], [marie]) } });

    const response = await as(request(app).patch('/projects/project-1'), marie).send({ title: 'Renommé', groupId: null });

    expect(response.status).toBe(400);
    expectBffContract('patch', '/projects/project-1', response);
    expect(response.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'body.groupId' })]));
    expect(projectApi.requests.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  test('mair_683 POST /projects refuses a project without a group and creates nothing', async () => {
    signIn(marie);
    mockProjectApi();

    const response = await as(request(app).post('/projects'), marie).send(createBody);

    expect(response.status).toBe(400);
    expectBffContract('post', '/projects', response);
    expect(response.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'body.groupId' })]));
    expect(projectApi.calls(PROJECT.projects, 'POST')).toHaveLength(0);
  });

  test('mair_683 POST /projects/:id/duplicate gives the copy the group of the source', async () => {
    signIn(marie);
    mockProjectApi({ createdProjectId: 12, bundles: {
      1: projectBundle(projetView(1, { name: 'Voirie', group: { id: 3, name: 'Roads' } }), [], [marie]),
      12: projectBundle(projetView(12, { name: 'Voirie', group: { id: 3, name: 'Roads' } }), [], [marie]),
    } });

    const response = await as(request(app).post('/projects/project-1/duplicate'), marie).send({});

    expect(response.status).toBe(201);
    expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ name: 'Voirie', group_id: 3 });
    expect(response.body.project.group).toEqual({ id: 'group-3', name: 'Roads' });
  });

  test('mair_683 POST /projects/:id/duplicate refuses a source without a group and creates nothing', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { group: null }), [], [marie]) } });

    const response = await as(request(app).post('/projects/project-1/duplicate'), marie).send({});

    expect(response.status).toBe(400);
    expectBffContract('post', '/projects/project-1/duplicate', response);
    expect(projectApi.calls(PROJECT.projects, 'POST')).toHaveLength(0);
  });

  // A Responsable who sees the project only through its group loses it when replacing the group.
  const loseProjectOnPatch = () => {
    const bundles = { 1: projectBundle(projetView(1, { group: { id: 3, name: 'Roads' } }), [], [alice]) };
    mockProjectApi({ bundles });
    projectApi.on('patch', PROJECT.project, () => {
      delete (bundles as Record<number, unknown>)[1];
      return { status: 204 };
    });
  };

  test('PATCH /projects/:id answers 204 when changing the group takes the project away from the caller', async () => {
    signIn(marie);
    loseProjectOnPatch();

    const response = await as(request(app).patch('/projects/project-1'), marie).send({ title: 'Renommé', groupId: 'group-5' });

    expect(response.status).toBe(204);
    expectBffContract('patch', '/projects/project-1', response);
    expect(response.text).toBe('');
    expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([{ name: 'Renommé', group_id: 5 }]);
  });

  test('PATCH /projects/:id writes the members before changing the group, so a caller who joins keeps the project', async () => {
    signIn(marie);
    // Marie sees the project only through its group until she is added as a member.
    const bundle = projectBundle(projetView(1, { group: { id: 3, name: 'Roads' } }), [], [alice]);
    const bundles: Record<number, typeof bundle> = { 1: bundle };
    mockProjectApi({ bundles });
    projectApi.on('post', PROJECT.users, () => {
      bundle.users = [...bundle.users, member(marie)];
      return { status: 200 };
    });
    projectApi.on('patch', PROJECT.project, () => {
      if (!bundle.users.some((member) => member.id === marie.id)) delete bundles[1];
      return { status: 204 };
    });

    const response = await as(request(app).patch('/projects/project-1'), marie).send({ responsibleId: `user-${marie.id}`, groupId: 'group-5' });

    expect(response.status).toBe(200);
    expectBffContract('patch', '/projects/project-1', response);
    const writes = projectApi.requests.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.template}`);
    expect(writes).toEqual([`POST ${PROJECT.users}`, `PATCH ${PROJECT.project}`]);
  });

  test('PATCH /projects/:id still answers 404 when the project disappears without a group change', async () => {
    signIn(marie);
    loseProjectOnPatch();

    const response = await as(request(app).patch('/projects/project-1'), marie).send({ title: 'Renommé' });

    expect(response.status).toBe(404);
    expectBffContract('patch', '/projects/project-1', response);
    // The 404 comes from the re-read after the write, not from an early refusal.
    expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([{ name: 'Renommé' }]);
    const sequence = projectApi.requests.filter((call) => call.template === PROJECT.project).map((call) => call.method);
    expect(sequence.slice(-2)).toEqual(['PATCH', 'GET']);
  });

  test('mair_683 PATCH /projects/:id refuses a group the caller may not link before writing the members', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { group: { id: 3, name: 'Roads' } }), [], [alice, marie]) } });

    const response = await as(request(app).patch('/projects/project-1'), marie)
      .send({ responsibleId: `user-${marie.id}`, assigneeIds: [], groupId: 'group-99' });

    expect(response.status).toBe(404);
    expectBffContract('patch', '/projects/project-1', response);
    expect(projectApi.requests.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  test('mair_683 POST /projects/:id/duplicate refuses a source group the caller may not link and creates nothing', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { group: { id: 8, name: 'Finances' } }), [], [marie]) } });

    const response = await as(request(app).post('/projects/project-1/duplicate'), marie).send({});

    expect(response.status).toBe(403);
    expectBffContract('post', '/projects/project-1/duplicate', response);
    expect(projectApi.calls(PROJECT.projects, 'POST')).toHaveLength(0);
  });
});

describe('MAIR-1086 milestones of a project', () => {
  const vote = milestoneView(7, { title: 'Vote du conseil', due_date: '2027-03-15' });

  test('the detail embeds the first milestones and their total', async () => {
    signIn(alice);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { can_manage: false }), [], [alice], { milestones: [vote], milestones_total: 3 }) } });

    const response = await as(request(app).get('/projects/project-1'), alice);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects/project-1', response);
    expect(response.body.project.milestones).toEqual([{ id: 'milestone-7', title: 'Vote du conseil', dueDate: '2027-03-15', reached: false }]);
    expect(response.body.project.milestonesTotal).toBe(3);
  });

  test('GET pages the milestones for whoever sees the project', async () => {
    signIn(alice);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice]) } });
    projectApi.on('get', PROJECT.milestones, { body: { milestones: [vote, milestoneView(8, { reached: true })], total: 5 } });

    const response = await as(request(app).get('/projects/project-1/milestones?page=2&limit=2'), alice);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects/project-1/milestones', response);
    expect(response.body.milestones.map((milestone: { id: string; reached: boolean }) => [milestone.id, milestone.reached]))
      .toEqual([['milestone-7', false], ['milestone-8', true]]);
    expect(response.body.pagination).toEqual({ page: 2, limit: 2, total: 5, hasNextPage: true });
    expect(pageOf(projectApi.calls(PROJECT.milestones, 'GET')[0].url)).toEqual({ limit: 2, offset: 2 });
  });

  test('GET answers 404 for a project the caller does not see, without reading the milestones', async () => {
    signIn(alice);
    mockProjectApi();

    const response = await as(request(app).get('/projects/project-1/milestones'), alice);

    expect(response.status).toBe(404);
    expectBffContract('get', '/projects/project-1/milestones', response);
    expect(projectApi.calls(PROJECT.milestones, 'GET')).toHaveLength(0);
  });

  test('POST creates a milestone for a manager and answers it', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [marie]) } });
    projectApi.on('post', PROJECT.milestones, { status: 201, body: vote });

    const response = await as(request(app).post('/projects/project-1/milestones'), marie)
      .send({ title: 'Vote du conseil', dueDate: '2027-03-15' });

    expect(response.status).toBe(201);
    expectBffContract('post', '/projects/project-1/milestones', response);
    expect(projectApi.calls(PROJECT.milestones, 'POST')[0].body).toEqual({ title: 'Vote du conseil', due_date: '2027-03-15' });
    expect(response.body).toEqual({ id: 'milestone-7', title: 'Vote du conseil', dueDate: '2027-03-15', reached: false });
  });

  test.each([
    ['a date-time', { title: 'Jalon', dueDate: '2027-03-15T00:00:00Z' }, 'body.dueDate'],
    ['an impossible date', { title: 'Jalon', dueDate: '2027-02-30' }, 'body.dueDate'],
    ['a blank title', { title: '   ', dueDate: '2027-03-15' }, 'body.title'],
    ['an unknown field', { title: 'Jalon', dueDate: '2027-03-15', owner: 'user-1' }, 'body'],
  ])('POST refuses %s with a 400 before any write', async (_name, body, path) => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [marie]) } });

    const response = await as(request(app).post('/projects/project-1/milestones'), marie).send(body);

    expect(response.status).toBe(400);
    expectBffContract('post', '/projects/project-1/milestones', response);
    expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
    expect(projectApi.calls(PROJECT.milestones, 'POST')).toHaveLength(0);
  });

  test('a plain member cannot write the milestones (403 before any write)', async () => {
    signIn(alice);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { can_manage: false }), [], [alice]) } });

    const responses = await Promise.all([
      as(request(app).post('/projects/project-1/milestones'), alice).send({ title: 'Jalon', dueDate: '2027-03-15' }),
      as(request(app).patch('/projects/project-1/milestones/milestone-7'), alice).send({ reached: true }),
      as(request(app).delete('/projects/project-1/milestones/milestone-7'), alice),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expectBffContract('post', '/projects/project-1/milestones', responses[0]);
    expectBffContract('patch', '/projects/project-1/milestones/milestone-7', responses[1]);
    expectBffContract('delete', '/projects/project-1/milestones/milestone-7', responses[2]);
    expect(projectApi.requests.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  test('PATCH sends the given fields only and answers the updated milestone', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [marie]) } });
    projectApi.on('patch', PROJECT.milestone, { body: { ...vote, reached: true } });

    const response = await as(request(app).patch('/projects/project-1/milestones/milestone-7'), marie).send({ reached: true });

    expect(response.status).toBe(200);
    expectBffContract('patch', '/projects/project-1/milestones/milestone-7', response);
    expect(projectApi.calls(PROJECT.milestone, 'PATCH')[0]).toMatchObject({ pathParams: { projectId: '1', milestoneId: '7' }, body: { reached: true } });
    expect(response.body.reached).toBe(true);
  });

  test('PATCH and DELETE relay the 404 of an unknown milestone', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [marie]) } });
    projectApi.on('patch', PROJECT.milestone, textError(404, 'Unknown milestone.'));
    projectApi.on('delete', PROJECT.milestone, textError(404, 'Unknown milestone.'));

    const patched = await as(request(app).patch('/projects/project-1/milestones/milestone-9'), marie).send({ title: 'Autre' });
    const deleted = await as(request(app).delete('/projects/project-1/milestones/milestone-9'), marie);

    expect([patched.status, deleted.status]).toEqual([404, 404]);
    expectBffContract('patch', '/projects/project-1/milestones/milestone-9', patched);
    expectBffContract('delete', '/projects/project-1/milestones/milestone-9', deleted);
  });

  test('DELETE removes a milestone with 204', async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [admin]) } });
    projectApi.on('delete', PROJECT.milestone, { status: 204 });

    const response = await as(request(app).delete('/projects/project-1/milestones/milestone-7'), admin);

    expect(response.status).toBe(204);
    expectBffContract('delete', '/projects/project-1/milestones/milestone-7', response);
    expect(projectApi.calls(PROJECT.milestone, 'DELETE')).toHaveLength(1);
  });

  test('a milestone id that is not milestone-<id> is a 400 before any call', async () => {
    signIn(admin);
    mockProjectApi();

    const response = await as(request(app).delete('/projects/project-1/milestones/task-7'), admin);

    expect(response.status).toBe(400);
    expectBffContract('delete', '/projects/project-1/milestones/task-7', response);
    expect(projectApi.requests).toEqual([]);
  });
});

describe('MAIR-1087 start date of a task', () => {
  const taskBody = {
    title: 'Réserver la salle', status: 'todo', priority: 'high',
    responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-11-20',
  };

  test('every task read carries its start date, null without one', async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [
      taskView(2, { start_date: '2026-09-01T00:00:00Z' }), taskView(3),
    ], [admin]) } });
    projectApi.on('get', PROJECT.archivedTasks, { body: { tasks: [taskView(4, { status: 'Completed', start_date: '2026-08-01T00:00:00Z' })], total: 1 } });

    const detail = await as(request(app).get('/projects/project-1'), admin);
    const archived = await as(request(app).get('/projects/project-1/archived-tasks'), admin);

    expect([detail.status, archived.status]).toEqual([200, 200]);
    expectBffContract('get', '/projects/project-1', detail);
    expectBffContract('get', '/projects/project-1/archived-tasks', archived);
    expect(detail.body.taskItems.map((task: { startDate: string | null }) => task.startDate)).toEqual(['2026-09-01T00:00:00Z', null]);
    expect(archived.body.tasks[0].startDate).toBe('2026-08-01T00:00:00Z');
  });

  test('POST /projects/:id/tasks sends the start date as midnight UTC of that day', async () => {
    signIn(admin);
    const bundles = { 1: projectBundle(projetView(1), [], [admin, alice]) };
    mockProjectApi({ bundles, createdTaskId: 30 });
    projectApi.on('post', PROJECT.tasks, () => {
      bundles[1].tasks.push(taskView(30, { start_date: '2026-11-02T00:00:00.000Z', due_date: '2026-11-20T00:00:00.000Z' }));
      return { body: createTaskResult(30) };
    });

    const response = await as(request(app).post('/projects/project-1/tasks'), admin).send({ ...taskBody, startDate: '2026-11-02' });

    expect(response.status).toBe(201);
    expectBffContract('post', '/projects/project-1/tasks', response);
    expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({
      start_date: '2026-11-02T00:00:00.000Z', due_date: '2026-11-20T00:00:00.000Z',
    });
    expect(response.body.startDate).toBe('2026-11-02T00:00:00.000Z');
  });

  test('POST without a start date sends none', async () => {
    signIn(admin);
    const bundles = { 1: projectBundle(projetView(1), [], [admin, alice]) };
    mockProjectApi({ bundles });
    projectApi.on('post', PROJECT.tasks, () => {
      bundles[1].tasks.push(taskView(30));
      return { body: createTaskResult(30) };
    });

    const response = await as(request(app).post('/projects/project-1/tasks'), admin).send({ ...taskBody, startDate: null });

    expect(response.status).toBe(201);
    expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).not.toHaveProperty('start_date');
    expect(response.body.startDate).toBeNull();
  });

  test.each([
    ['POST', 'post', '/projects/project-1/tasks', { ...taskBody, startDate: '2026-11-21' }],
    ['PATCH', 'patch', '/projects/project-1/tasks/task-2', { startDate: '2026-12-01', dueDate: '2026-11-30' }],
  ] as const)('%s refuses a start date after the due date with a 400 naming the field, before any write', async (_name, method, uri, body) => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin, alice]) } });

    const response = await as(request(app)[method](uri), admin).send(body);

    expect(response.status).toBe(400);
    expectBffContract(method, uri, response);
    expect(response.body.error.details).toEqual([{ path: 'body.startDate', message: 'startDate must be at or before dueDate' }]);
    expect(projectApi.requests.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  test('POST refuses a start date that is not a date', async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [admin]) } });

    const response = await as(request(app).post('/projects/project-1/tasks'), admin).send({ ...taskBody, startDate: 'demain' });

    expect(response.status).toBe(400);
    expectBffContract('post', '/projects/project-1/tasks', response);
    expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain('body.startDate');
    expect(projectApi.calls(PROJECT.tasks, 'POST')).toHaveLength(0);
  });

  test.each([
    ['sets', { startDate: '2026-10-01' }, { start_date: '2026-10-01T00:00:00.000Z' }],
    ['clears with null', { startDate: null }, { start_date: null }],
    ['clears with an empty string', { startDate: '' }, { start_date: null }],
    ['keeps when absent', { title: 'Autre titre' }, { name: 'Autre titre' }],
  ] as const)('PATCH %s the start date', async (_name, body, expected) => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

    const response = await as(request(app).patch('/projects/project-1/tasks/task-2'), admin).send(body);

    expect(response.status).toBe(200);
    expectBffContract('patch', '/projects/project-1/tasks/task-2', response);
    expect(projectApi.calls(PROJECT.task, 'PATCH')[0].body).toEqual(expected);
  });

  test("PATCH relays Project API's 400 for a start date after the stored due date", async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
    projectApi.on('patch', PROJECT.task, textError(400, 'Invalid `start_date`: must be at or before `due_date`'));

    const response = await as(request(app).patch('/projects/project-1/tasks/task-2'), admin).send({ startDate: '2027-01-01' });

    expect(response.status).toBe(400);
    expectBffContract('patch', '/projects/project-1/tasks/task-2', response);
    // The 400 is Project API's: the BFF sent the PATCH once.
    expect(projectApi.calls(PROJECT.task, 'PATCH').map((call) => call.body)).toEqual([{ start_date: '2027-01-01T00:00:00.000Z' }]);
    expect(JSON.stringify(response.body)).not.toContain('start_date');
  });

  test('duplicating a project copies the start date of a task that has a due date', async () => {
    signIn(admin);
    const source = projectBundle(projetView(1, { group: { id: 3, name: 'Roads' } }), [
      taskView(2, { start_date: '2026-09-01T00:00:00Z', due_date: '2026-10-01T00:00:00Z' }),
      taskView(3, { start_date: '2026-09-01T00:00:00Z', due_date: null }),
    ], [admin]);
    mockProjectApi({ bundles: { 1: source, 12: projectBundle(projetView(12), [], [admin]) }, createdProjectId: 12 });

    const response = await as(request(app).post('/projects/project-1/duplicate'), admin).send({});

    expect(response.status).toBe(201);
    const created = projectApi.calls(PROJECT.tasks, 'POST').map((call) => (call.body as { start_date?: string }).start_date);
    expect(created).toEqual(['2026-09-01T00:00:00.000Z', undefined]);
  });
});

describe('MAIR-1088 member roles', () => {
  /** Alice holds the User role but is a `manager` member of project 1: Project API says she manages it. */
  const managedByAlice = () => ({
    ...projectBundle(projetView(1, { can_manage: true, my_role: 'manager' }), [
      taskView(2, { assigned_to: alice.id }),
      taskView(3, { assigned_to: marie.id, status: 'InProgress' }),
      taskView(4, { assigned_to: marie.id }),
    ], [alice, marie]),
    users: [member(alice, 'manager'), member(marie, 'contributor')],
  });

  test('the detail lists every member with their role and load, and the caller role', async () => {
    signIn(alice);
    mockProjectApi({ bundles: { 1: managedByAlice() } });

    const response = await as(request(app).get('/projects/project-1'), alice);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects/project-1', response);
    expect(response.body.project.myRole).toBe('manager');
    expect(response.body.project.members).toEqual([
      { id: 'user-2', name: 'Alice Martin', avatarUrl: null, role: 'manager', load: { tasksOpen: 1, tasksTotal: 1 } },
      { id: 'user-3', name: 'Marie Durand', avatarUrl: null, role: 'contributor', load: { tasksOpen: 2, tasksTotal: 2 } },
    ]);
    // A manager member manages the project and sees every task, not only hers.
    expect(response.body.project.permissions).toMatchObject({ canEdit: true, canDelete: true, canAssignMembers: true });
    expect(response.body.taskItems.map((task: { id: string }) => task.id)).toEqual(['task-2', 'task-3', 'task-4']);
    expect(response.body.taskItems[1].permissions).toMatchObject({ canEdit: true, canDelete: true });
  });

  test('the projects page carries the members roles, the caller role and the rights Project API gives', async () => {
    signIn(alice);
    mockProjectApi({ projects: [
      projectListItem(1, { can_manage: true, my_role: 'manager', members: [member(alice, 'manager')], members_total: 1 }),
      projectListItem(2, { can_manage: false, my_role: 'reader', members: [member(alice, 'reader')], members_total: 1 }),
      projectListItem(3),
    ] });

    const response = await as(request(app).get('/projects-page'), alice);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects-page', response);
    expect(response.body.projects.map((project: { myRole: string | null; permissions: { canEdit: boolean } }) =>
      [project.myRole, project.permissions.canEdit])).toEqual([['manager', true], ['reader', false], [null, false]]);
    expect(response.body.projects[0].members).toEqual([{ id: 'user-2', name: 'Alice Martin', avatarUrl: null, role: 'manager' }]);
  });

  test('a manager member updates the project and assigns a task to another member of it', async () => {
    signIn(alice);
    const bundles = { 1: managedByAlice() };
    mockProjectApi({ bundles });
    projectApi.on('post', PROJECT.tasks, () => {
      bundles[1].tasks.push(taskView(30, { assigned_to: marie.id }));
      return { body: createTaskResult(30) };
    });

    const patched = await as(request(app).patch('/projects/project-1'), alice).send({ budgetVoted: 100 });
    const created = await as(request(app).post('/projects/project-1/tasks'), alice).send({
      title: 'Commander', status: 'todo', priority: 'low', responsibleId: `user-${marie.id}`, assigneeIds: [], labels: [], dueDate: '',
    });

    expect([patched.status, created.status]).toEqual([200, 201]);
    expectBffContract('post', '/projects/project-1/tasks', created);
    expect(created.body.permissions.canEdit).toBe(true);
    expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ assigned_to: marie.id });
  });

  test("a manager member edits and deletes a task assigned to someone else, Project API's can_manage read with one task", async () => {
    signIn(alice);
    mockProjectApi({ bundles: { 1: managedByAlice() } });

    const patched = await as(request(app).patch('/projects/project-1/tasks/task-3'), alice).send({ title: 'Renommée' });
    const deleted = await as(request(app).delete('/projects/project-1/tasks/task-4'), alice);

    expect([patched.status, deleted.status]).toEqual([200, 204]);
    expectBffContract('patch', '/projects/project-1/tasks/task-3', patched);
    expect(patched.body.permissions).toMatchObject({ canEdit: true, canDelete: true });
    expect(projectApi.calls(PROJECT.project, 'GET').map((call) => pageOf(call.url).limit)).toContain(1);
  });

  test('a manager member sees the archived tasks of the others', async () => {
    signIn(alice);
    mockProjectApi({ bundles: { 1: managedByAlice() } });
    projectApi.on('get', PROJECT.archivedTasks, { body: { tasks: [taskView(9, { status: 'Completed', assigned_to: marie.id })], total: 1 } });

    const response = await as(request(app).get('/projects/project-1/archived-tasks'), alice);

    expect(response.status).toBe(200);
    expect(response.body.tasks.map((task: { id: string }) => task.id)).toEqual(['task-9']);
  });

  test.each(['contributor', 'reader'] as const)('a %s member with the User role still cannot manage the project', async (role) => {
    signIn(alice);
    const bundle = managedByAlice();
    bundle.project = projetView(1, { can_manage: false, my_role: role });
    bundle.users = [member(alice, role), member(marie, 'contributor')];
    mockProjectApi({ bundles: { 1: bundle } });

    const responses = await Promise.all([
      as(request(app).patch('/projects/project-1'), alice).send({ title: 'Non' }),
      as(request(app).patch('/projects/project-1/tasks/task-3'), alice).send({ title: 'Non' }),
      as(request(app).post('/projects/project-1/members'), alice).send({ userId: 'user-1' }),
    ]);

    // A task not assigned to her is not visible to her (404), as before MAIR-1088.
    expect(responses.map((response) => response.status)).toEqual([403, 404, 403]);
    expect(projectApi.requests.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  test('a manager role reads no project to manage a task', async () => {
    signIn(marie);
    mockProjectApi({ bundles: { 1: managedByAlice() } });

    const response = await as(request(app).patch('/projects/project-1/tasks/task-3'), marie).send({ title: 'Renommée' });

    expect(response.status).toBe(200);
    expect(projectApi.calls(PROJECT.project, 'GET')).toHaveLength(0);
  });

  describe('member routes', () => {
    test('POST /projects/:id/members adds a member with a role and answers every member', async () => {
      signIn(admin);
      const bundle = projectBundle(projetView(1), [], [admin]);
      mockProjectApi({ bundles: { 1: bundle } });
      projectApi.on('post', PROJECT.users, ({ body }) => {
        const { user_id: id, role } = body as { user_id: number; role?: 'manager' };
        bundle.users = [...bundle.users, { id, name: 'Alice Martin', role: role ?? 'contributor' }];
        return { status: 200 };
      });

      const response = await as(request(app).post('/projects/project-1/members'), admin).send({ userId: 'user-2', role: 'manager' });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/members', response);
      expect(projectApi.calls(PROJECT.users, 'POST')[0].body).toEqual({ user_id: 2, role: 'manager' });
      expect(response.body.members.map((entry: { id: string; role: string }) => [entry.id, entry.role]))
        .toEqual([['user-1', 'contributor'], ['user-2', 'manager']]);
    });

    test('POST without a role lets Project API make a contributor', async () => {
      signIn(admin);
      const bundle = projectBundle(projetView(1), [], [admin]);
      mockProjectApi({ bundles: { 1: bundle } });
      projectApi.on('post', PROJECT.users, ({ body }) => {
        const { user_id: id, role } = body as { user_id: number; role?: 'manager' };
        bundle.users = [...bundle.users, { id, name: 'Alice Martin', role: role ?? 'contributor' }];
        return { status: 200 };
      });

      const response = await as(request(app).post('/projects/project-1/members'), admin).send({ userId: 'user-2' });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/members', response);
      expect(projectApi.calls(PROJECT.users, 'POST')[0].body).toEqual({ user_id: 2 });
      expect(response.body.members).toContainEqual(expect.objectContaining({ id: 'user-2', role: 'contributor' }));
    });

    test('POST refuses an agent outside the team of a Responsable', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [marie]) } });

      const response = await as(request(app).post('/projects/project-1/members'), marie).send({ userId: 'user-1' });

      expect(response.status).toBe(403);
      expectBffContract('post', '/projects/project-1/members', response);
      expect(projectApi.calls(PROJECT.users, 'POST')).toHaveLength(0);
    });

    test.each([
      ['an unknown role', { userId: 'user-2', role: 'owner' }, 'body.role'],
      ['a userId of another kind', { userId: 'project-2' }, 'body.userId'],
    ])('POST refuses %s with a 400', async (_name, body, path) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [admin]) } });

      const response = await as(request(app).post('/projects/project-1/members'), admin).send(body);

      expect(response.status).toBe(400);
      expectBffContract('post', '/projects/project-1/members', response);
      expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
    });

    test('PATCH changes the role of a member', async () => {
      signIn(admin);
      const bundle = projectBundle(projetView(1), [], [admin, alice]);
      mockProjectApi({ bundles: { 1: bundle } });
      projectApi.on('patch', PROJECT.user, ({ body }) => {
        bundle.users = bundle.users.map((entry) => (entry.id === alice.id ? { ...entry, role: (body as { role: 'reader' }).role } : entry));
        return { status: 204 };
      });

      const response = await as(request(app).patch('/projects/project-1/members/user-2'), admin).send({ role: 'reader' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/members/user-2', response);
      expect(projectApi.calls(PROJECT.user, 'PATCH')[0]).toMatchObject({ pathParams: { projectId: '1', userId: '2' }, body: { role: 'reader' } });
      expect(response.body.members.find((entry: { id: string }) => entry.id === 'user-2').role).toBe('reader');
    });

    test.each([
      [404, 'Not a member.'],
      [409, 'The owner keeps the manager role.'],
    ])('PATCH relays the %s of Project API', async (status, message) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [admin]) } });
      projectApi.on('patch', PROJECT.user, textError(status, message));

      const response = await as(request(app).patch('/projects/project-1/members/user-9'), admin).send({ role: 'reader' });

      expect(response.status).toBe(status);
      expectBffContract('patch', '/projects/project-1/members/user-9', response);
      expect(JSON.stringify(response.body)).not.toContain(message);
    });

    test('DELETE removes a member, and relays the 409 of the owner', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [admin, alice]) } });

      const removed = await as(request(app).delete('/projects/project-1/members/user-2'), admin);
      projectApi.on('delete', PROJECT.user, textError(409, 'The owner cannot be removed.'));
      const owner = await as(request(app).delete('/projects/project-1/members/user-1'), admin);

      expect([removed.status, owner.status]).toEqual([204, 409]);
      expectBffContract('delete', '/projects/project-1/members/user-2', removed);
      expectBffContract('delete', '/projects/project-1/members/user-1', owner);
    });

    test('a plain member cannot change the members, and a malformed user id is a 400', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice]) } });

      const refused = await Promise.all([
        as(request(app).patch('/projects/project-1/members/user-2'), alice).send({ role: 'manager' }),
        as(request(app).delete('/projects/project-1/members/user-2'), alice),
      ]);
      const malformed = await as(request(app).delete('/projects/project-1/members/task-2'), alice);

      expect(refused.map((response) => response.status)).toEqual([403, 403]);
      expect(malformed.status).toBe(400);
      expectBffContract('delete', '/projects/project-1/members/task-2', malformed);
      expect(projectApi.requests.filter((call) => call.method !== 'GET')).toEqual([]);
    });

    test('PATCH /projects/:id with assigneeIds keeps the owner Project API refuses to remove', async () => {
      signIn(admin);
      const bundle = projectBundle(projetView(1), [], [admin, alice]);
      mockProjectApi({ bundles: { 1: bundle } });
      // Only a successful removal changes the members; the owner's 409 leaves them as they are.
      projectApi.on('delete', PROJECT.user, ({ pathParams }) => {
        if (pathParams.userId === String(admin.id)) return textError(409, 'The owner cannot be removed.');
        bundle.users = bundle.users.filter((entry) => String(entry.id) !== pathParams.userId);
        return { status: 204 };
      });
      projectApi.on('post', PROJECT.users, ({ body }) => {
        bundle.users = [...bundle.users, { id: (body as { user_id: number }).user_id, name: 'Marie Durand', role: 'contributor' }];
        return { status: 200 };
      });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ responsibleId: 'user-3', assigneeIds: [] });

      expect(response.status).toBe(200);
      expect(projectApi.calls(PROJECT.user, 'DELETE').map((call) => call.pathParams.userId).sort()).toEqual(['1', '2']);
      const memberIds = response.body.project.members.map((entry: { id: string }) => entry.id);
      expect(memberIds).toEqual(expect.arrayContaining(['user-1', 'user-3']));
      expect(memberIds).not.toContain('user-2');
    });
  });
});

describe('MAIR-1196 adding a member does not replace the responsible of the project', () => {
  // Project API sorts the members by name: "Alice Martin" (a contributor) comes before "Marie Durand" (the manager).
  const managedByMarie = () => ({
    ...projectBundle(projetView(1), [], [alice, marie]),
    users: [member(alice, 'contributor'), member(marie, 'manager')],
  });

  test('the detail reads the manager member as the responsible, not the first member', async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: managedByMarie() } });

    const response = await as(request(app).get('/projects/project-1'), admin);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects/project-1', response);
    expect(response.body.project.responsible).toEqual({ id: 'user-3', name: 'Marie Durand', avatarUrl: null });
  });

  test('the projects page reads the manager member as the responsible, else the first member', async () => {
    signIn(admin);
    mockProjectApi({ projects: [
      projectListItem(1, { members: [member(alice, 'contributor'), member(marie, 'manager')], members_total: 2 }),
      projectListItem(2, { members: [member(alice, 'reader'), member(marie, 'contributor')], members_total: 2 }),
    ] });

    const response = await as(request(app).get('/projects-page'), admin);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects-page', response);
    expect(response.body.projects.map((project: { responsible: { id: string } }) => project.responsible.id))
      .toEqual(['user-3', 'user-2']);
  });

  test('adding, removing then adding back a member keeps the responsible in the detail and the page', async () => {
    signIn(admin);
    const bundle = projectBundle(projetView(1), [], [marie]);
    bundle.users = [member(marie, 'manager')];
    mockProjectApi({ bundles: { 1: bundle } });
    const listItem = () => projectListItem(1, { members: bundle.users, members_total: bundle.users.length });
    projectApi.on('post', PROJECT.users, ({ body }) => {
      const { user_id: id, role } = body as { user_id: number; role?: 'manager' };
      // Alice sorts before Marie, like Project API's order by name.
      bundle.users = [{ id, name: 'Alice Martin', role: role ?? 'contributor' }, ...bundle.users];
      return { status: 200 };
    });
    projectApi.on('delete', PROJECT.user, ({ pathParams }) => {
      bundle.users = bundle.users.filter((entry) => String(entry.id) !== pathParams.userId);
      return { status: 204 };
    });
    projectApi.on('get', PROJECT.projects, () => ({ body: projectsResult([listItem()]) }));

    const responsibles: string[] = [];
    const readBack = async () => {
      const [detail, page] = await Promise.all([
        as(request(app).get('/projects/project-1'), admin),
        as(request(app).get('/projects-page'), admin),
      ]);
      expect([detail.status, page.status]).toEqual([200, 200]);
      responsibles.push(detail.body.project.responsible.id, page.body.projects[0].responsible.id);
    };

    expect((await as(request(app).post('/projects/project-1/members'), admin).send({ userId: 'user-2', role: 'contributor' })).status).toBe(201);
    await readBack();
    expect((await as(request(app).delete('/projects/project-1/members/user-2'), admin)).status).toBe(204);
    await readBack();
    expect((await as(request(app).post('/projects/project-1/members'), admin).send({ userId: 'user-2' })).status).toBe(201);
    await readBack();

    expect(responsibles).toEqual(Array(6).fill('user-3'));
  });

  test('PATCH with responsibleId promotes a member already in the project to manager', async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: managedByMarie() } });

    const response = await as(request(app).patch('/projects/project-1'), admin).send({ responsibleId: 'user-2' });

    expect(response.status).toBe(200);
    expect(projectApi.calls(PROJECT.users, 'POST')).toHaveLength(0);
    expect(projectApi.calls(PROJECT.user, 'PATCH').map((call) => [call.pathParams.userId, call.body])).toEqual([['2', { role: 'manager' }]]);
  });

  test('PATCH with assigneeIds keeps the manager as the responsible, not the first member', async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: managedByMarie() } });

    const response = await as(request(app).patch('/projects/project-1'), admin).send({ assigneeIds: [] });

    expect(response.status).toBe(200);
    // Marie, the manager, stays; Alice, first by name, is removed.
    expect(projectApi.calls(PROJECT.user, 'DELETE').map((call) => call.pathParams.userId)).toEqual(['2']);
    expect(projectApi.calls(PROJECT.user, 'PATCH')).toHaveLength(0);
  });

  test('the responsible Project API records wins over the member rule, in the detail and the page', async () => {
    signIn(admin);
    // Alice, a contributor, is the recorded responsible; Marie is a manager member.
    mockProjectApi({
      bundles: { 1: { ...managedByMarie(), project: projetView(1, { responsible: { id: alice.id, name: 'Alice Martin' } }) } },
      projects: [projectListItem(1, {
        members: [member(alice, 'contributor'), member(marie, 'manager')], members_total: 2,
        responsible: { id: alice.id, name: 'Alice Martin' },
      })],
    });

    const [detail, page] = await Promise.all([
      as(request(app).get('/projects/project-1'), admin),
      as(request(app).get('/projects-page'), admin),
    ]);

    expect([detail.status, page.status]).toEqual([200, 200]);
    expectBffContract('get', '/projects/project-1', detail);
    expect(detail.body.project.responsible).toEqual({ id: 'user-2', name: 'Alice Martin', avatarUrl: null });
    expect(page.body.projects[0].responsible.id).toBe('user-2');
  });

  test('a recorded responsible outside the first members of the page is still read', async () => {
    signIn(admin);
    mockProjectApi({ projects: [projectListItem(1, {
      members: [member(alice, 'contributor')], members_total: 6, responsible: { id: 42, name: 'Zoé Vidal' },
    })] });

    const page = await as(request(app).get('/projects-page'), admin);

    expect(page.status).toBe(200);
    expect(page.body.projects[0].responsible).toEqual({ id: 'user-42', name: 'Zoé Vidal', avatarUrl: null });
  });

  test('PATCH with responsibleId writes the members first, then records the responsible with the project', async () => {
    signIn(admin);
    mockProjectApi({ bundles: { 1: managedByMarie() } });

    const response = await as(request(app).patch('/projects/project-1'), admin)
      .send({ title: 'Voirie', responsibleId: 'user-3', assigneeIds: [] });

    expect(response.status).toBe(200);
    const writes = projectApi.requests.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.template}`);
    expect(writes).toEqual([`DELETE ${PROJECT.user}`, `PATCH ${PROJECT.project}`]);
    expect(projectApi.calls(PROJECT.project, 'PATCH').map((call) => call.body)).toEqual([{ name: 'Voirie', responsible_id: marie.id }]);
  });

  test('a duplicate keeps the recorded responsible of its source', async () => {
    signIn(admin);
    mockProjectApi({ createdProjectId: 12, bundles: {
      1: { ...managedByMarie(), project: projetView(1, { group: { id: 3, name: 'Roads' }, responsible: { id: marie.id, name: 'Marie Durand' } }) },
      12: projectBundle(projetView(12), [], [alice, marie]),
    } });
    projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

    const response = await as(request(app).post('/projects/project-1/duplicate'), admin).send({});

    expect(response.status).toBe(201);
    expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ responsible_id: marie.id });
  });

  test('a duplicate keeps the managers of its source', async () => {
    signIn(admin);
    mockProjectApi({ createdProjectId: 12, bundles: {
      1: { ...managedByMarie(), project: projetView(1, { name: 'Voirie', group: { id: 3, name: 'Roads' } }) },
      12: projectBundle(projetView(12, { name: 'Voirie' }), [], [alice, marie]),
    } });
    projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

    const response = await as(request(app).post('/projects/project-1/duplicate'), admin).send({});

    expect(response.status).toBe(201);
    expect(projectApi.calls(PROJECT.users, 'POST').map((call) => call.body))
      .toEqual(expect.arrayContaining([{ user_id: alice.id }, { user_id: marie.id, role: 'manager' }]));
  });
});

describe('MAIR-1089 activity, project comments and bulk deletion', () => {
  const comment = {
    kind: 'comment' as const, id: 12, task_id: null, task_title: null, author_id: alice.id, author_name: 'Alice Martin',
    message: 'Devis reçu.', changes: null, label: 'Comment', created_at: '2026-11-20T08:00:00.000Z',
  };
  const statusChange = {
    kind: 'status_changed' as const, id: 40, task_id: 4, task_title: 'Commander', author_id: null, author_name: null,
    message: null, changes: { status: { from: 'Todo', to: 'InProgress' } }, label: 'Status changed: À faire → En cours',
    created_at: '2026-11-19T08:00:00.000Z',
  };

  test('GET /projects/:id/activity pages the comments and the task history with public ids', async () => {
    signIn(alice);
    mockProjectApi();
    projectApi.on('get', PROJECT.activity, { body: { items: [comment, statusChange], total: 7 } });

    const response = await as(request(app).get('/projects/project-1/activity?page=2&limit=2'), alice);

    expect(response.status).toBe(200);
    expectBffContract('get', '/projects/project-1/activity', response);
    expect(response.body.items).toEqual([
      {
        kind: 'comment', id: 'comment-12', taskId: null, taskTitle: null, author: { id: 'user-2', name: 'Alice Martin' },
        message: 'Devis reçu.', changes: null, label: 'Comment', createdAt: '2026-11-20T08:00:00.000Z',
      },
      {
        kind: 'status_changed', id: 'history-40', taskId: 'task-4', taskTitle: 'Commander', author: null, message: null,
        changes: { status: { from: 'Todo', to: 'InProgress' } }, label: 'Status changed: À faire → En cours',
        createdAt: '2026-11-19T08:00:00.000Z',
      },
    ]);
    expect(response.body.pagination).toEqual({ page: 2, limit: 2, total: 7, hasNextPage: true });
    expect(pageOf(projectApi.calls(PROJECT.activity, 'GET')[0].url)).toEqual({ limit: 2, offset: 2 });
  });

  test('GET /projects/:id/activity defaults to 50 entries and relays the 404 of an invisible project', async () => {
    signIn(alice);
    mockProjectApi();
    projectApi.on('get', PROJECT.activity, textError(404, 'Unknown project.'));

    const response = await as(request(app).get('/projects/project-1/activity'), alice);

    expect(response.status).toBe(404);
    expectBffContract('get', '/projects/project-1/activity', response);
    expect(pageOf(projectApi.calls(PROJECT.activity, 'GET')[0].url)).toEqual({ limit: 50, offset: 0 });
  });

  test('POST /projects/:id/comments posts the trimmed comment and answers the activity entry', async () => {
    signIn(alice);
    mockProjectApi();
    projectApi.on('post', PROJECT.projectComments, { status: 201, body: comment });

    const response = await as(request(app).post('/projects/project-1/comments'), alice).send({ message: '  Devis reçu.  ' });

    expect(response.status).toBe(201);
    expectBffContract('post', '/projects/project-1/comments', response);
    expect(projectApi.calls(PROJECT.projectComments, 'POST')[0].body).toEqual({ message: 'Devis reçu.' });
    expect(response.body).toMatchObject({ kind: 'comment', id: 'comment-12', author: { id: 'user-2' } });
  });

  test.each([
    ['a blank message', { message: '   ' }],
    ['markup', { message: '<b>Devis</b>' }],
    ['a message over 2000 characters', { message: 'a'.repeat(2_001) }],
  ])('POST /projects/:id/comments refuses %s with a 400 before any call', async (_name, body) => {
    signIn(alice);
    mockProjectApi();

    const response = await as(request(app).post('/projects/project-1/comments'), alice).send(body);

    expect(response.status).toBe(400);
    expectBffContract('post', '/projects/project-1/comments', response);
    expect(response.body.error.details.map((detail: { path: string }) => detail.path)).toContain('body.message');
    expect(projectApi.requests).toEqual([]);
  });

  test('POST /projects/:id/comments relays the 404 of an invisible project', async () => {
    signIn(alice);
    mockProjectApi();
    projectApi.on('post', PROJECT.projectComments, textError(404, 'Unknown project.'));

    const response = await as(request(app).post('/projects/project-1/comments'), alice).send({ message: 'Bonjour' });

    expect(response.status).toBe(404);
    expectBffContract('post', '/projects/project-1/comments', response);
  });

  test('POST /projects/bulk-delete sends each id once and answers one result per project', async () => {
    signIn(alice);
    mockProjectApi();
    projectApi.on('post', PROJECT.bulkDelete, { body: { results: [
      { id: 4, status: 'deleted' }, { id: 5, status: 'forbidden' }, { id: 6, status: 'not_found' },
    ] } });

    const response = await as(request(app).post('/projects/bulk-delete'), alice)
      .send({ projectIds: ['project-4', 'project-5', 'project-4', 'project-6'] });

    expect(response.status).toBe(200);
    expectBffContract('post', '/projects/bulk-delete', response);
    expect(projectApi.calls(PROJECT.bulkDelete, 'POST')[0].body).toEqual({ ids: [4, 5, 6] });
    expect(response.body.results).toEqual([
      { projectId: 'project-4', status: 'deleted' },
      { projectId: 'project-5', status: 'forbidden' },
      { projectId: 'project-6', status: 'not_found' },
    ]);
    // Not taken for a project id by the `/:projectId` routes.
    expect(projectApi.calls(PROJECT.project, 'GET')).toHaveLength(0);
  });

  test.each([
    ['no project', { projectIds: [] }],
    ['more than 100 projects', { projectIds: Array.from({ length: 101 }, (_, i) => `project-${i + 1}`) }],
    ['an id of another kind', { projectIds: ['task-4'] }],
  ])('POST /projects/bulk-delete refuses %s with a 400 before any call', async (_name, body) => {
    signIn(admin);
    mockProjectApi();

    const response = await as(request(app).post('/projects/bulk-delete'), admin).send(body);

    expect(response.status).toBe(400);
    expectBffContract('post', '/projects/bulk-delete', response);
    expect(response.body.error.details.map((detail: { path: string }) => detail.path.split('.').slice(0, 2).join('.'))).toContain('body.projectIds');
    expect(projectApi.requests).toEqual([]);
  });
});
