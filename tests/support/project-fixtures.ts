import { createHmac } from 'node:crypto';
// Upstream bodies typed by the models of the installed @mairie360/project-api-openapi and core-api-openapi packages:
// a field added, removed or renamed by a contract breaks the compilation of the tests. They are also validated at run
// time against the rebuilt contracts (upstream-contracts.test.ts, HTTP mocks). Session tokens of the tests.

import { getCoreAPIMairie360 } from '@mairie360/core-api-openapi/endpoints/coreAPIMairie360';
import type { DirectoryUser, DirectoryUsersResultView, GetMeResponseView, Group } from '@mairie360/core-api-openapi/model';
import { getProjectAPIMairie360 } from '@mairie360/project-api-openapi/endpoints/projectAPIMairie360';
import {
  type CreateProjectResultView,
  type CreateTaskResultView,
  FieldType,
  type GetProjectResultView,
  type GetProjectUsersResultView,
  type GetProjectsResultView,
  type ProjectListItemView,
  ProjectStatus,
  type ProjetView,
  type TaskCollaborationView,
  type TaskComment,
  type TaskHistoryEntry,
  TaskPriority,
  TaskStatus,
  type TaskView,
  type User as ProjectMember,
} from '@mairie360/project-api-openapi/model';

/** Chemins des opérations amont, tels que les construisent les clients générés (helpers `get*Url`). */
export const projectApiUrls = getProjectAPIMairie360();
export const coreApiUrls = getCoreAPIMairie360();

export type Role = 'Admin' | 'Maire' | 'Responsable' | 'User' | 'Guest';

/** Agents de la mairie utilisés par les tests : l'id est celui de Core API et de Project API. */
export const agents = {
  admin: { id: 1, first_name: 'Admin', last_name: 'Mairie', role: 'Admin' as Role },
  alice: { id: 2, first_name: 'Alice', last_name: 'Martin', role: 'User' as Role },
  marie: { id: 3, first_name: 'Marie', last_name: 'Durand', role: 'Responsable' as Role },
};
export type Agent = (typeof agents)[keyof typeof agents];

export function group(id: number, name = `Groupe ${id}`): Group {
  return { id, name, owner_id: 1, description: null };
}

/** Body of Core `GET /api/v1/user/me/`. Fields the BFF Project does not read are present on purpose. */
export function coreMe(agent: Agent, fields: Partial<GetMeResponseView> = {}): GetMeResponseView {
  return {
    first_name: agent.first_name,
    last_name: agent.last_name,
    email: `${agent.first_name.toLowerCase()}@mairie.test`,
    phone: null,
    status: 'active',
    role: agent.role,
    roles: [agent.role],
    groups: [group(1, 'Service urbanisme')],
    ...fields,
  };
}

/** Secret of the tests (tests/support/env.ts): the BFF verifies the session tokens with it (bffs-lib requireSession). */
export const JWT_SECRET = 'project-contract-test-secret';

/**
 * HS256 session token of `sub` signed with `secret` (fixed expiry, so a token is the same in every call). `claims`
 * adds claims, such as the `role` Core signs (MAIR-529); without it the token predates that claim.
 */
export function sessionToken(sub: string | number, secret = JWT_SECRET, exp = 4_102_444_800, claims: object = {}): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: String(sub), exp, ...claims })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/** `Authorization` header of the session of `sub`: verified by the BFF, then forwarded to the APIs (mocked). */
export function bearer(sub: string | number, claims: object = {}): string {
  return `Bearer ${sessionToken(sub, JWT_SECRET, 4_102_444_800, claims)}`;
}

// --- Project API (@mairie360/project-api-openapi) ---

export function projetView(id: number, overrides: Partial<ProjetView> = {}): ProjetView {
  return {
    id, name: `Projet ${id}`, description: `Description du projet ${id}`, status: ProjectStatus.Active,
    priority: TaskPriority.Medium, ...overrides,
  };
}

/** Project of `GET /api/v1/projects/` with the aggregates of its tasks (MAIR-474): none by default. */
export function projectListItem(id: number, overrides: Partial<ProjectListItemView> = {}): ProjectListItemView {
  return {
    ...projetView(id),
    tasks_total: 0, tasks_completed: 0, priority: TaskPriority.Medium, due_date: null, members: [], members_total: 0,
    ...overrides,
  };
}

/** A page of `GET /api/v1/projects/`, its summary counted over `projects` unless given. */
export function projectsResult(
  projects: ProjectListItemView[],
  total = projects.length,
  summary?: GetProjectsResultView['summary'],
): GetProjectsResultView {
  const count = (keep: (project: ProjectListItemView) => boolean) => projects.filter(keep).length;
  return {
    projects,
    total,
    summary: summary ?? {
      by_status: {
        todo: count((p) => p.status === ProjectStatus.Todo),
        active: count((p) => p.status === ProjectStatus.Active),
        review: count((p) => p.status === ProjectStatus.Review),
        suspended: count((p) => p.status === ProjectStatus.Suspended),
        completed: count((p) => p.status === ProjectStatus.Completed),
        other: count((p) => p.status === ProjectStatus.Error),
      },
      by_priority: {
        low: count((p) => p.priority === TaskPriority.Low),
        medium: count((p) => p.priority === TaskPriority.Medium),
        high: count((p) => p.priority === TaskPriority.High),
      },
    },
  };
}
export const createProjectResult = (project_id: number): CreateProjectResultView => ({ project_id });

export function taskView(id: number, overrides: Partial<TaskView> = {}): TaskView {
  return {
    id,
    title: `Tâche ${id}`,
    description: '',
    status: TaskStatus.Todo,
    priority: TaskPriority.Medium,
    due_date: '2026-10-01T00:00:00Z',
    assigned_to: null,
    fields: [{ label: 'Date', task_type: FieldType.date, fields_options: [{ option: '2026-10-01T00:00:00Z', is_selected: true }] }],
    ...overrides,
  };
}

export const createTaskResult = (task_id: number, name = 'Tâche'): CreateTaskResultView => ({ task_id, name, description: '' });

/** Membre d'un projet tel que Project API le renvoie (identifiant et nom). */
export function member(agent: Agent): ProjectMember {
  return { id: agent.id, name: `${agent.first_name} ${agent.last_name}` };
}

export const projectUsersResult = (users: ProjectMember[], total = users.length): GetProjectUsersResultView => ({ users, total });

/**
 * Body of `GET /api/v1/projects/{projectId}/` (GetProjectResultView): the project, one page of tasks and the
 * first members. The totals default to a single complete page.
 */
export function projectBundle(
  project: ProjetView,
  tasks: TaskView[] = [],
  users: Agent[] = [],
  totals: { tasks_total?: number; users_total?: number; tasks_archived?: number } = {},
): GetProjectResultView {
  return {
    project, tasks, tasks_total: tasks.length, tasks_archived: 0, users: users.map(member), users_total: users.length,
    ...totals,
  };
}

export function taskComment(overrides: Partial<TaskComment> = {}): TaskComment {
  return { id: 'comment-1', message: 'Devis reçu.', author: { id: 'user-2', name: 'Alice Martin' }, createdAt: '2026-09-01T08:00:00.000Z', ...overrides };
}

export function taskHistoryEntry(overrides: Partial<TaskHistoryEntry> = {}): TaskHistoryEntry {
  return {
    id: 'history-1', action: 'task_updated', label: 'Tâche modifiée.',
    author: { id: 'user-1', name: 'Admin Mairie' }, createdAt: '2026-09-16T08:00:00.000Z',
    ...overrides,
  };
}

export const collaboration = (
  comments: TaskComment[],
  history: TaskHistoryEntry[],
  totals: { comments_total?: number; history_total?: number } = {},
): TaskCollaborationView => ({
  comments, comments_total: comments.length, history, history_total: history.length, ...totals,
});

// --- Core API (@mairie360/core-api-openapi), annuaire ---

export function directoryUser(agent: Agent): DirectoryUser {
  return {
    id: agent.id,
    first_name: agent.first_name,
    last_name: agent.last_name,
    email: `${agent.first_name.toLowerCase()}@mairie.test`,
    // Core >= 2.1.0 (MAIR-564): one role per user in `role`, the deprecated `roles` holds at most that one.
    role: agent.role,
    roles: [agent.role],
    group_ids: [1],
  };
}

/** Corps de `GET /api/v1/user/` de Core API (DirectoryUsersResultView). */
export function coreDirectory(list: Agent[]): DirectoryUsersResultView {
  return { users: list.map(directoryUser) };
}
