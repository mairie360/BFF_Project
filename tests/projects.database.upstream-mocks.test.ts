import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';

// Mode base de données (PROJECT_DB_ACCESS par défaut, celui de la production). PostgreSQL n'a pas de contrat
// OpenAPI : le repository reste simulé par jest.mock. BFF User (GET /me) et Project API sont servis par des mocks
// pilotés par les contrats de leurs paquets @mairie360/*-openapi installés ; dans ce mode, le BFF ne doit
// jamais appeler Project API (le mock enregistre tout appel et le signale comme non mocké).
jest.mock('../src/repositories/projectRepository', () => ({
  isProjectDatabaseAccessEnabled: () => true,
  addTaskComment: jest.fn(),
  appendTaskHistory: jest.fn(),
  createProjectRecord: jest.fn(),
  createTaskRecord: jest.fn(),
  deleteProjectRecord: jest.fn(),
  deleteTaskRecord: jest.fn(),
  getProjectBundleFromDatabase: jest.fn(),
  getProjectPermissions: jest.fn(),
  getTaskCollaboration: jest.fn(),
  getTaskPermissions: jest.fn(),
  listAssignableUsers: jest.fn(),
  listVisibleProjectRows: jest.fn(),
  setProjectClosed: jest.fn(),
  syncProjectMembers: jest.fn(),
  updateProjectRecord: jest.fn(),
  updateTaskRecord: jest.fn(),
}));

import * as repository from '../src/repositories/projectRepository';
import type { ProjectPermissions, TaskPermissions } from '../src/repositories/projectRepository';
import { ContractMockServer } from './support/contract-mock-server';
import { OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract } from './support/orval-contract';
import { agents, bearer, member, projectBundle, projetView, sessionResponse, taskView, type Agent } from './support/project-fixtures';

const userBff = new ContractMockServer('USER_BFF', loadOrvalContract('@mairie360/bff-user-openapi'));
const projectApi = new ContractMockServer('PROJECT_API', loadOrvalContract('@mairie360/project-api-openapi'));
const mocks = [userBff, projectApi];
const bffContract = OpenApiContract.load(path.join(__dirname, '..', 'contracts', 'openapi.json'));

let app: Express;

beforeAll(async () => {
  await Promise.all(mocks.map((mock) => mock.start()));
  process.env.PROJECT_API_BASE_PATH = projectApi.url;
  delete process.env.PROJECT_DB_ACCESS;
  app = (await import('../src/app')).default;
});
afterAll(async () => { await Promise.all(mocks.map((mock) => mock.stop())); });

beforeEach(() => {
  jest.clearAllMocks();
  for (const mock of mocks) mock.reset();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  process.env.USER_BFF_URL = userBff.url;
  jest.mocked(repository.getProjectPermissions).mockResolvedValue(projectPermissions(true));
  jest.mocked(repository.getTaskPermissions).mockResolvedValue(taskPermissions(true));
  jest.mocked(repository.listAssignableUsers).mockResolvedValue(Object.values(agents).map(member));
  jest.mocked(repository.appendTaskHistory).mockResolvedValue();
  jest.mocked(repository.syncProjectMembers).mockResolvedValue();
});
afterEach(() => {
  jest.restoreAllMocks();
  expect(projectApi.requests.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([]);
  expect(mocks.flatMap((mock) => mock.violations)).toEqual([]);
});

function expectBffContract(method: string, pathname: string, response: request.Response) {
  const match = bffContract.match(method, pathname);
  expect(match?.template).toBeDefined();
  const { documented, schema } = bffContract.responseSchema(match!, response.status);
  expect({ status: response.status, documented }).toEqual({ status: response.status, documented: true });
  if (schema) expect(bffContract.validate(schema, response.body)).toEqual([]);
}

function projectPermissions(canManage: boolean, canView = true): ProjectPermissions {
  const manage = canView && canManage;
  return { canView, canEdit: manage, canDuplicate: manage, canDelete: manage, canCreateTask: manage, canAssignMembers: manage, canClose: manage };
}

function taskPermissions(canManage: boolean, assigned = false): TaskPermissions {
  return { canView: canManage || assigned, canEdit: canManage, canDelete: canManage, canUpdateStatus: canManage || assigned, canComment: canManage || assigned };
}

/** Contexte utilisateur que project-user.ts construit à partir de sessionResponse(agent). */
const userContext = (agent: Agent) => ({
  id: agent.id,
  name: `${agent.first_name} ${agent.last_name}`,
  email: `${agent.first_name.toLowerCase()}@mairie.test`,
  role: agent.role,
  roles: [agent.role],
  groups: [{ id: 1, name: 'Service urbanisme' }],
});

function signIn(agent: Agent) {
  userBff.on('get', '/me', { body: sessionResponse(agent) });
}
const as = (call: request.Test, agent: Agent) => call.set('Authorization', bearer(agent.id));

const { admin, alice, marie } = agents;

describe('Project BFF in database mode with contract-driven BFF User and Project API mocks', () => {
  describe('reads', () => {
    test('GET /projects-page builds filtered, paginated projects from database bundles', async () => {
      signIn(admin);
      jest.mocked(repository.listVisibleProjectRows).mockResolvedValue([
        projetView(1, { name: 'Rénovation de la médiathèque' }),
        projetView(2, { name: 'Archivage', status: 'Completed' }),
        projetView(3, { name: 'Voirie', description: 'Réfection de la rue des écoles' }),
      ]);
      jest.mocked(repository.getProjectBundleFromDatabase).mockImplementation(async (id) => ({
        1: projectBundle(projetView(1, { name: 'Rénovation de la médiathèque' }), [
          taskView(1, { status: 'Completed', priority: 'High', due_date: '2026-11-01T00:00:00.000Z' }),
          taskView(2, { priority: 'Low', due_date: '2026-10-15T00:00:00.000Z', assigned_to: alice.id }),
        ], [alice, marie]),
        2: projectBundle(projetView(2, { name: 'Archivage', status: 'Completed' }), [taskView(3, { status: 'Completed' })]),
        3: projectBundle(projetView(3, { name: 'Voirie', description: 'Réfection de la rue des écoles' }), [], [marie]),
      })[id] ?? null);

      const response = await as(request(app).get('/projects-page?status=in-progress&q=R%C3%A9&limit=1&page=1&view=table'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(repository.listVisibleProjectRows).toHaveBeenCalledWith(userContext(admin));
      expect(repository.getProjectBundleFromDatabase).toHaveBeenCalledTimes(3);
      expect(response.body.projects).toEqual([expect.objectContaining({
        id: 'project-1', title: 'Rénovation de la médiathèque', status: 'in-progress', statusLabel: 'En cours',
        priority: 'high', priorityLabel: 'Haute', progress: 50, dueDate: '2026-10-15T00:00:00.000Z',
        responsible: { id: 'user-2', name: 'Alice Martin', avatarUrl: null },
        assignees: [{ id: 'user-2', name: 'Alice Martin', avatarUrl: null }, { id: 'user-3', name: 'Marie Durand', avatarUrl: null }],
        tasks: { total: 2, completed: 1 }, permissions: projectPermissions(true),
      })]);
      // « Voirie » (in-progress, « Réfection… ») correspond aussi au filtre : la pagination le laisse en page 2.
      expect(response.body.pagination).toEqual({ page: 1, limit: 1, total: 2, hasNextPage: true });
      expect(response.body.summary).toEqual({
        totalProjects: 2, projectsByStatus: { todo: 0, 'in-progress': 2, review: 0, done: 0 }, projectsByPriority: { high: 1, medium: 1, low: 0 },
      });
      expect(response.body.kanban.columns[1]).toEqual({ status: 'in-progress', label: 'En cours', projectIds: ['project-1', 'project-3'], count: 2 });
      expect(response.body.options.members.map((option: { value: string; label: string }) => [option.value, option.label]))
        .toEqual([['user-1', 'Admin Mairie'], ['user-2', 'Alice Martin'], ['user-3', 'Marie Durand']]);
      expect(response.body.page.defaultView).toBe('table');
    });

    test('GET /projects/:id only returns the tasks an employee may see', async () => {
      signIn(alice);
      jest.mocked(repository.getProjectPermissions).mockResolvedValue(projectPermissions(false));
      jest.mocked(repository.getTaskPermissions).mockImplementation(async (user, _projectId, _taskId, assignedTo) => taskPermissions(false, assignedTo === user.id));
      jest.mocked(repository.getProjectBundleFromDatabase).mockResolvedValue(projectBundle(projetView(1), [
        taskView(1, { assigned_to: marie.id }),
        taskView(2, { assigned_to: alice.id, status: 'InProgress' }),
      ], [marie, alice]));

      const response = await as(request(app).get('/projects/project-1'), alice);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1', response);
      expect(repository.getTaskPermissions).toHaveBeenCalledWith(userContext(alice), 1, 1, marie.id);
      expect(response.body.project.permissions).toEqual(projectPermissions(false));
      expect(response.body.taskItems).toEqual([expect.objectContaining({
        id: 'task-2', status: 'in-progress', responsible: { id: 'user-2', name: 'Alice Martin', avatarUrl: null },
        permissions: { canView: true, canEdit: false, canDelete: false, canUpdateStatus: true, canComment: true },
      })]);
    });

    test('GET /projects/:id answers 404 for a project outside the user visibility', async () => {
      signIn(alice);
      jest.mocked(repository.getProjectPermissions).mockResolvedValue(projectPermissions(false, false));

      const response = await as(request(app).get('/projects/project-9'), alice);

      expect(response.status).toBe(404);
      expectBffContract('get', '/projects/project-9', response);
      expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: 'Projet introuvable ou inaccessible.', details: [] });
      expect(repository.getProjectBundleFromDatabase).not.toHaveBeenCalled();
    });

    test('GET /projects/:id answers 404 when the project disappears between the checks and the read', async () => {
      signIn(admin);
      jest.mocked(repository.getProjectBundleFromDatabase).mockResolvedValue(null);

      const response = await as(request(app).get('/projects/project-9'), admin);

      expect(response.status).toBe(404);
      expectBffContract('get', '/projects/project-9', response);
      expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: 'Projet introuvable.', details: [] });
    });

    test('GET /projects/:id/tasks/:taskId/collaboration returns the stored comments and history', async () => {
      signIn(admin);
      const author = { id: 'user-2', name: 'Alice Martin' };
      jest.mocked(repository.getTaskCollaboration).mockResolvedValue({
        comments: [{ id: 'comment-1', message: 'Devis reçu.', author, createdAt: '2026-09-01T08:00:00.000Z' }],
        history: [{ id: 'status-4', action: 'status_changed', label: 'Statut modifié : todo → in_progress', author, createdAt: '2026-09-02T08:00:00.000Z', changes: { status: { from: 'todo', to: 'in_progress' } } }],
      });

      const response = await as(request(app).get('/projects/project-1/tasks/task-2/collaboration'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1/tasks/task-2/collaboration', response);
      expect(repository.getTaskPermissions).toHaveBeenCalledWith(userContext(admin), 1, 2);
      expect(repository.getTaskCollaboration).toHaveBeenCalledWith(1, 2);
    });

    test('hides database error details behind a generic 500', async () => {
      signIn(admin);
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.mocked(repository.listVisibleProjectRows).mockRejectedValue(new Error('password authentication failed for user "postgres"'));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(500);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'INTERNAL_SERVER_ERROR', message: 'Erreur interne du serveur.', details: [] });
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe('writes', () => {
    const createBody = {
      title: 'Fête du village', description: 'Organisation de la fête', status: 'todo', priority: 'medium',
      responsibleId: 'user-2', assigneeIds: ['user-3'], labels: ['événement'], dueDate: '2026-07-14T00:00:00Z',
      taskItems: [{ title: 'Réserver la salle', status: 'todo', priority: 'high', assigneeIds: [], labels: ['Urgent'], dueDate: '2026-06-25T00:00:00Z' }],
    };

    test('POST /projects creates the project, its members and tasks in the database', async () => {
      signIn(admin);
      jest.mocked(repository.createProjectRecord).mockResolvedValue(12);
      jest.mocked(repository.createTaskRecord).mockResolvedValue(30);
      jest.mocked(repository.getProjectBundleFromDatabase).mockResolvedValue(projectBundle(
        projetView(12, { name: 'Fête du village', description: 'Organisation de la fête' }),
        [taskView(30, { title: 'Réserver la salle', priority: 'High', due_date: '2026-06-25T00:00:00.000Z' })],
        [alice, marie],
      ));

      const response = await as(request(app).post('/projects').send(createBody), admin);

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects', response);
      expect(repository.createProjectRecord).toHaveBeenCalledWith(admin.id, { title: 'Fête du village', description: 'Organisation de la fête' });
      expect(repository.syncProjectMembers).toHaveBeenCalledWith(12, [alice.id, marie.id]);
      expect(repository.createTaskRecord).toHaveBeenCalledWith(12, {
        title: 'Réserver la salle', status: 'Todo', priority: 'High', dueDate: '2026-06-25T00:00:00Z', assignedTo: null,
        fields: [
          { label: 'Date', task_type: 'date', fields_options: [{ option: '2026-06-25T00:00:00Z', is_selected: true }] },
          { label: 'Urgent', task_type: 'select', fields_options: [{ option: 'Urgent', is_selected: true }] },
        ],
      });
      expect(repository.appendTaskHistory).toHaveBeenCalledWith(12, 30, userContext(admin), 'task_created', 'Tâche « Réserver la salle » créée.');
      expect(response.body.project).toMatchObject({
        id: 'project-12', title: 'Fête du village', status: 'todo', priority: 'medium', labels: ['événement'],
        dueDate: '2026-07-14T00:00:00Z', tasks: { total: 1, completed: 0 }, responsible: { id: 'user-2' },
      });
      expect(response.body.taskItems).toEqual([expect.objectContaining({ id: 'task-30', title: 'Réserver la salle', priority: 'high' })]);
    });

    test('POST /projects forbids a Responsable to assign an agent outside their team', async () => {
      signIn(marie);
      jest.mocked(repository.listAssignableUsers).mockResolvedValue([member(marie), member(alice)]);

      const response = await as(request(app).post('/projects').send({ ...createBody, responsibleId: 'user-3', assigneeIds: ['user-1'] }), marie);

      expect(response.status).toBe(403);
      expectBffContract('post', '/projects', response);
      expect(response.body.error).toEqual({ code: 'FORBIDDEN', message: 'Vous pouvez uniquement assigner des agents de votre équipe.', details: [] });
      expect(repository.listAssignableUsers).toHaveBeenCalledWith(userContext(marie));
      expect(repository.createProjectRecord).not.toHaveBeenCalled();
    });

    test('PATCH /projects/:id updates the record and synchronizes the members', async () => {
      signIn(marie);
      jest.mocked(repository.listAssignableUsers).mockResolvedValue([member(marie), member(alice)]);
      jest.mocked(repository.updateProjectRecord).mockResolvedValue();
      jest.mocked(repository.getProjectBundleFromDatabase).mockResolvedValue(projectBundle(projetView(1, { name: 'Voirie 2027' }), [], [marie, alice]));

      const response = await as(request(app).patch('/projects/project-1').send({ title: 'Voirie 2027', responsibleId: 'user-3', assigneeIds: ['user-2'], status: 'review' }), marie);

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1', response);
      expect(repository.updateProjectRecord).toHaveBeenCalledWith(1, { title: 'Voirie 2027', responsibleId: 'user-3', assigneeIds: ['user-2'], status: 'review' });
      expect(repository.syncProjectMembers).toHaveBeenCalledWith(1, [marie.id, alice.id]);
      expect(response.body.project).toMatchObject({ title: 'Voirie 2027', status: 'review', statusLabel: 'En revue' });
    });

    test('POST /projects/:id/duplicate copies the project, its members and its tasks', async () => {
      signIn(admin);
      jest.mocked(repository.getProjectBundleFromDatabase)
        .mockResolvedValueOnce(projectBundle(projetView(1, { name: 'Voirie' }), [taskView(4, { title: 'Chiffrage', status: 'Completed', priority: 'Urgent' })], [alice]))
        .mockResolvedValueOnce(projectBundle(projetView(13, { name: 'Voirie' }), [taskView(40, { title: 'Chiffrage' })], [alice]));
      jest.mocked(repository.createProjectRecord).mockResolvedValue(13);
      jest.mocked(repository.createTaskRecord).mockResolvedValue(40);

      const response = await as(request(app).post('/projects/project-1/duplicate'), admin);

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/duplicate', response);
      expect(repository.createProjectRecord).toHaveBeenCalledWith(admin.id, { title: 'Voirie', description: 'Description du projet 1' });
      expect(repository.syncProjectMembers).toHaveBeenCalledWith(13, [alice.id]);
      expect(repository.createTaskRecord).toHaveBeenCalledWith(13, expect.objectContaining({ title: 'Chiffrage', status: 'Completed', priority: 'High' }));
      expect(response.body.project).toMatchObject({ id: 'project-13', status: 'todo', tasks: { total: 1, completed: 0 } });
    });

    test('PATCH /projects/:id/tasks/:taskId maps the BFF body to the database update', async () => {
      signIn(admin);
      jest.mocked(repository.updateTaskRecord).mockResolvedValue();
      jest.mocked(repository.getProjectBundleFromDatabase)
        .mockResolvedValueOnce(projectBundle(projetView(1), [taskView(2)], [alice, marie]))
        .mockResolvedValueOnce(projectBundle(projetView(1), [taskView(2, { title: 'Chiffrage validé', priority: 'Low', assigned_to: marie.id })], [alice, marie]));

      const response = await as(request(app).patch('/projects/project-1/tasks/task-2').send({ title: 'Chiffrage validé', priority: 'low', responsibleId: 'user-3' }), admin);

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/tasks/task-2', response);
      expect(repository.updateTaskRecord).toHaveBeenCalledWith(1, 2, { title: 'Chiffrage validé', status: undefined, priority: 'Low', dueDate: undefined, assignedTo: marie.id });
      expect(repository.appendTaskHistory).toHaveBeenCalledWith(1, 2, userContext(admin), 'task_updated', 'Tâche « Chiffrage validé » modifiée.', { title: 'Chiffrage validé', priority: 'low', responsibleId: 'user-3' });
      expect(response.body).toMatchObject({ id: 'task-2', title: 'Chiffrage validé', priority: 'low', responsible: { id: 'user-3', name: 'Marie Durand' } });
    });

    test('PATCH /projects/:id/tasks/:taskId/status lets the assigned employee change the status only', async () => {
      signIn(alice);
      jest.mocked(repository.getProjectPermissions).mockResolvedValue(projectPermissions(false));
      jest.mocked(repository.getTaskPermissions).mockImplementation(async (user, _projectId, _taskId, assignedTo) => taskPermissions(false, assignedTo === user.id));
      jest.mocked(repository.updateTaskRecord).mockResolvedValue();
      jest.mocked(repository.getProjectBundleFromDatabase)
        .mockResolvedValueOnce(projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id })], [alice]))
        .mockResolvedValueOnce(projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id, status: 'InProgress' })], [alice]));

      const response = await as(request(app).patch('/projects/project-1/tasks/task-2/status').send({ status: 'in-progress' }), alice);

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/tasks/task-2/status', response);
      expect(repository.updateTaskRecord).toHaveBeenCalledWith(1, 2, { title: undefined, status: 'InProgress', priority: undefined, dueDate: undefined, assignedTo: undefined });
      expect(repository.appendTaskHistory).toHaveBeenCalledWith(1, 2, userContext(alice), 'status_changed', 'Statut de « Tâche 2 » modifié en in-progress.', { status: { from: 'Todo', to: 'in-progress' } });
      expect(response.body).toMatchObject({ id: 'task-2', status: 'in-progress', permissions: { canEdit: false, canUpdateStatus: true } });
    });

    test('PATCH /projects/:id/tasks/:taskId/status forbids an employee who is not assigned', async () => {
      signIn(alice);
      jest.mocked(repository.getTaskPermissions).mockImplementation(async (user, _projectId, _taskId, assignedTo) => taskPermissions(false, assignedTo === user.id));
      jest.mocked(repository.getProjectBundleFromDatabase).mockResolvedValue(projectBundle(projetView(1), [taskView(2, { assigned_to: marie.id })], [marie]));

      const response = await as(request(app).patch('/projects/project-1/tasks/task-2/status').send({ status: 'done' }), alice);

      expect(response.status).toBe(403);
      expectBffContract('patch', '/projects/project-1/tasks/task-2/status', response);
      expect(repository.updateTaskRecord).not.toHaveBeenCalled();
    });

    test('PATCH /projects/:id/close suspends the project for a review request', async () => {
      signIn(admin);
      jest.mocked(repository.setProjectClosed).mockResolvedValue();
      jest.mocked(repository.getProjectBundleFromDatabase).mockResolvedValue(projectBundle(projetView(1, { status: 'Suspended' }), [taskView(2)], [alice]));

      const response = await as(request(app).patch('/projects/project-1/close').send({ status: 'review' }), admin);

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/close', response);
      expect(repository.setProjectClosed).toHaveBeenCalledWith(1, 'suspended');
      expect(response.body.project).toMatchObject({ id: 'project-1', status: 'review', statusLabel: 'En revue' });
    });

    test('DELETE routes delete through the database for a manager', async () => {
      signIn(marie);
      jest.mocked(repository.deleteProjectRecord).mockResolvedValue();
      jest.mocked(repository.deleteTaskRecord).mockResolvedValue();

      const [task, project] = [
        await as(request(app).delete('/projects/project-1/tasks/task-2'), marie),
        await as(request(app).delete('/projects/project-1'), marie),
      ];

      expect([task.status, project.status]).toEqual([204, 204]);
      expectBffContract('delete', '/projects/project-1/tasks/task-2', task);
      expect(repository.deleteTaskRecord).toHaveBeenCalledWith(1, 2);
      expect(repository.deleteProjectRecord).toHaveBeenCalledWith(1);
    });

    test('POST /projects/:id/tasks/:taskId/comments stores the comment for the session user', async () => {
      signIn(alice);
      jest.mocked(repository.getTaskPermissions).mockResolvedValue(taskPermissions(false, true));
      jest.mocked(repository.addTaskComment).mockImplementation(async (_projectId, _taskId, user, message) => ({
        id: 'comment-9', message, author: { id: `user-${user.id}`, name: user.name }, createdAt: '2026-09-15T10:00:00.000Z',
      }));

      const response = await as(request(app).post('/projects/project-1/tasks/task-2/comments').send({ message: 'Fait.' }), alice);

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/tasks/task-2/comments', response);
      expect(repository.addTaskComment).toHaveBeenCalledWith(1, 2, userContext(alice), 'Fait.');
    });
  });
});
