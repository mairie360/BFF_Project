// Réponses amont conformes aux contrats des paquets @mairie360/project-api-openapi et @mairie360/bff-user-openapi
// installés (validées dans upstream-contracts.test.ts), et jetons de session des tests.

import type { ProjetView, TaskView } from '@mairie360/project-api-openapi/model';

type Overrides<T> = Partial<T> & Record<string, unknown>;

export type Role = 'Admin' | 'Maire' | 'Responsable' | 'User' | 'Guest';

/** Agents de la mairie utilisés par les tests : l'id est celui de la base et de Project API. */
export const agents = {
  admin: { id: 1, first_name: 'Admin', last_name: 'Mairie', role: 'Admin' as Role },
  alice: { id: 2, first_name: 'Alice', last_name: 'Martin', role: 'User' as Role },
  marie: { id: 3, first_name: 'Marie', last_name: 'Durand', role: 'Responsable' as Role },
};
export type Agent = (typeof agents)[keyof typeof agents];

export function group(id: number, name = `Groupe ${id}`) {
  return { id, name, owner_id: 1, description: null };
}

/** Corps de `GET /me` (SessionResponse). Les champs non lus par le BFF Project sont volontairement présents. */
export function sessionResponse(agent: Agent, user: Overrides<{ role: string; id: number | string }> = {}) {
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

export function projetView(id: number, overrides: Partial<ProjetView> = {}): ProjetView {
  return { id, name: `Projet ${id}`, description: `Description du projet ${id}`, status: 'Active', ...overrides };
}

export function taskView(id: number, overrides: Partial<TaskView> = {}): TaskView {
  return {
    id,
    title: `Tâche ${id}`,
    description: '',
    status: 'Todo',
    priority: 'Medium',
    due_date: '2026-10-01T00:00:00Z',
    assigned_to: null,
    fields: [{ label: 'Date', task_type: 'date', fields_options: [{ option: '2026-10-01T00:00:00Z', is_selected: true }] }],
    ...overrides,
  };
}

/** Membre d'un projet tel que Project API le renvoie (identifiant et nom). */
export function member(agent: Agent) {
  return { id: agent.id, name: `${agent.first_name} ${agent.last_name}` };
}

export function projectBundle(project: ProjetView, tasks: TaskView[] = [], users: Agent[] = []) {
  return { project, tasks, users: users.map(member) };
}

/** Corps de `GET /api/v1/user/` de Core API (DirectoryUsersResultView). */
export function coreDirectory(list: Agent[]) {
  return {
    users: list.map((agent) => ({
      id: agent.id,
      first_name: agent.first_name,
      last_name: agent.last_name,
      email: `${agent.first_name.toLowerCase()}@mairie.test`,
      roles: [agent.role],
      group_ids: [1],
    })),
  };
}
