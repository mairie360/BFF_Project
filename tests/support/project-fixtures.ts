// Réponses amont typées par les modèles des paquets @mairie360/project-api-openapi, core-api-openapi et
// bff-user-openapi installés : un champ ajouté, retiré ou renommé par un contrat fait échouer la compilation des
// tests. Elles sont en plus validées à l'exécution contre les contrats reconstruits (upstream-contracts.test.ts,
// mocks HTTP). Jetons de session des tests.

import { getBffUser } from '@mairie360/bff-user-openapi/endpoints/bffUser';
import type { SessionResponse, SessionResponseGroupsItem, SessionResponseUser } from '@mairie360/bff-user-openapi/model';
import { getCoreAPIMairie360 } from '@mairie360/core-api-openapi/endpoints/coreAPIMairie360';
import type { DirectoryUser, DirectoryUsersResultView } from '@mairie360/core-api-openapi/model';
import { getProjectAPIMairie360 } from '@mairie360/project-api-openapi/endpoints/projectAPIMairie360';
import {
  type CreateProjectResultView,
  type CreateTaskResultView,
  FieldType,
  type GetProjectResultView,
  type GetProjectUsersResultView,
  type GetProjectsResultView,
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
export const userBffUrls = getBffUser();

export type Role = 'Admin' | 'Maire' | 'Responsable' | 'User' | 'Guest';

/** Agents de la mairie utilisés par les tests : l'id est celui de Core API et de Project API. */
export const agents = {
  admin: { id: 1, first_name: 'Admin', last_name: 'Mairie', role: 'Admin' as Role },
  alice: { id: 2, first_name: 'Alice', last_name: 'Martin', role: 'User' as Role },
  marie: { id: 3, first_name: 'Marie', last_name: 'Durand', role: 'Responsable' as Role },
};
export type Agent = (typeof agents)[keyof typeof agents];

export function group(id: number, name = `Groupe ${id}`): SessionResponseGroupsItem {
  return { id, name, owner_id: 1, description: null };
}

/** Corps de `GET /me` de BFF User (SessionResponse). Les champs non lus par le BFF Project sont volontairement présents. */
export function sessionResponse(agent: Agent, user: Partial<SessionResponseUser> = {}): SessionResponse {
  return {
    user: {
      id: agent.id,
      first_name: agent.first_name,
      last_name: agent.last_name,
      email: `${agent.first_name.toLowerCase()}@mairie.test`,
      phone: null,
      status: 'active',
      role: agent.role,
      ...user,
    },
    groups: [group(1, 'Service urbanisme')],
    roles: [{ id: 3, name: agent.role }],
  };
}

/**
 * Jeton Bearer au format JWT dont seul le `sub` peut être lu par le BFF Project, en secours de `user.id`
 * (la signature est vérifiée par BFF User, simulé ici).
 */
export function bearer(sub: string | number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: String(sub), exp: 4_102_444_800 })}.signature`;
}

// --- Project API (@mairie360/project-api-openapi) ---

export function projetView(id: number, overrides: Partial<ProjetView> = {}): ProjetView {
  return { id, name: `Projet ${id}`, description: `Description du projet ${id}`, status: ProjectStatus.Active, ...overrides };
}

export const projectsResult = (projects: ProjetView[]): GetProjectsResultView => ({ projects });
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

export const createTaskResult = (task_id: number, name = 'Tâche'): CreateTaskResultView => ({ task_id, name, description: null });

/** Membre d'un projet tel que Project API le renvoie (identifiant et nom). */
export function member(agent: Agent): ProjectMember {
  return { id: agent.id, name: `${agent.first_name} ${agent.last_name}` };
}

export const projectUsersResult = (users: ProjectMember[]): GetProjectUsersResultView => ({ users });

/** Corps de `GET /api/v1/projects/{projectId}/` (GetProjectResultView) : projet, tâches et membres. */
export function projectBundle(project: ProjetView, tasks: TaskView[] = [], users: Agent[] = []): GetProjectResultView {
  return { project, tasks, users: users.map(member) };
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

export const collaboration = (comments: TaskComment[], history: TaskHistoryEntry[]): TaskCollaborationView => ({ comments, history });

// --- Core API (@mairie360/core-api-openapi), annuaire ---

export function directoryUser(agent: Agent): DirectoryUser {
  return {
    id: agent.id,
    first_name: agent.first_name,
    last_name: agent.last_name,
    email: `${agent.first_name.toLowerCase()}@mairie.test`,
    roles: [agent.role],
    group_ids: [1],
  };
}

/** Corps de `GET /api/v1/user/` de Core API (DirectoryUsersResultView). */
export function coreDirectory(list: Agent[]): DirectoryUsersResultView {
  return { users: list.map(directoryUser) };
}
