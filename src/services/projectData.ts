import type { ProjetView, TaskView, User } from '@mairie360/project-api-openapi/model';
import { isAxiosError } from 'axios';
import projectClient from '../clients/projectClient';
import { listDirectoryUsers } from '../clients/coreDirectory';
import {
  canManageProjects,
  isGlobalProjectRole,
  type ProjectUserContext,
} from '../auth/project-user';

// Toutes les données projet viennent de Project API (contrat @mairie360/project-api-openapi) et
// l'annuaire des agents de Core API : le BFF n'interroge plus PostgreSQL.

export type ProjectPermissions = {
  canView: boolean;
  canEdit: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canCreateTask: boolean;
  canAssignMembers: boolean;
  canClose: boolean;
};

export type TaskPermissions = {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canUpdateStatus: boolean;
  canComment: boolean;
};

export type ProjectBundle = {
  project: ProjetView;
  tasks: TaskView[];
  users: User[];
};

function isNotFound(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}

/** Projet visible par l'appelant, ou `null` s'il n'existe pas ou ne lui est pas visible (404). */
export async function getProjectBundle(projectId: number): Promise<ProjectBundle | null> {
  try {
    const { data } = await projectClient.getProject(projectId);
    return { project: data.project, tasks: data.tasks, users: data.users };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Projets visibles par l'appelant (Project API applique les règles de visibilité). */
export async function listVisibleProjects(): Promise<ProjetView[]> {
  const { data } = await projectClient.getProjects();
  return data.projects;
}

/**
 * Droits sur un projet. `visible` évite une lecture supplémentaire quand l'appelant sait déjà que le
 * projet lui est visible (il vient de la liste ou d'un bundle déjà chargé).
 */
export async function getProjectPermissions(
  user: ProjectUserContext,
  projectId: number,
  visible?: boolean,
): Promise<ProjectPermissions> {
  const canView = visible ?? (await getProjectBundle(projectId)) !== null;
  const canManage = canView && canManageProjects(user.role);

  return {
    canView,
    canEdit: canManage,
    canDuplicate: canManage,
    canDelete: canManage,
    canCreateTask: canManage,
    canAssignMembers: canManage,
    canClose: canManage,
  };
}

/**
 * Droits sur une tâche. `assignedUserId` évite une lecture supplémentaire quand la tâche est déjà
 * connue (`undefined` la fait relire pour savoir si l'appelant en est l'assigné).
 */
export async function getTaskPermissions(
  user: ProjectUserContext,
  projectId: number,
  taskId: number,
  assignedUserId?: number | null,
): Promise<TaskPermissions> {
  const bundle = assignedUserId === undefined ? await getProjectBundle(projectId) : undefined;
  const canView = assignedUserId === undefined ? bundle !== null : true;
  const projectPermissions = await getProjectPermissions(user, projectId, canView);
  const canManage = projectPermissions.canEdit;
  const assignedTo = assignedUserId === undefined
    ? bundle?.tasks.find((task) => task.id === taskId)?.assigned_to ?? null
    : assignedUserId;
  const assignedToCurrentUser = projectPermissions.canView && assignedTo === user.id;

  return {
    canView: canManage || assignedToCurrentUser,
    canEdit: canManage,
    canDelete: canManage,
    canUpdateStatus: canManage || assignedToCurrentUser,
    canComment: canManage || assignedToCurrentUser,
  };
}

/**
 * Agents que l'appelant peut assigner : tous pour un Admin ou un Maire, les membres de ses groupes
 * pour un Responsable, lui-même sinon.
 */
export async function listAssignableUsers(user: ProjectUserContext): Promise<User[]> {
  if (isGlobalProjectRole(user.role)) {
    return toApiUsers(await listDirectoryUsers({}));
  }

  if (user.role === 'Responsable') {
    const groupIds = user.groups.map((group) => group.id).filter((id): id is number => id !== undefined);
    return groupIds.length > 0 ? toApiUsers(await listDirectoryUsers({ groupIds })) : selfOnly(user);
  }

  return selfOnly(user);
}

function selfOnly(user: ProjectUserContext): User[] {
  return [{ id: user.id, name: user.name }];
}

function toApiUsers(users: Array<{ id: number; first_name: string; last_name: string }>): User[] {
  return users.map((user) => ({
    id: user.id,
    name: `${user.first_name} ${user.last_name}`.trim(),
  }));
}

/** Met à jour le titre, la description et/ou le statut d'un projet. */
export async function updateProjectRecord(
  projectId: number,
  input: { title?: string; description?: string; status?: string },
): Promise<void> {
  await projectClient.updateProject(projectId, {
    ...(input.title !== undefined ? { name: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status !== undefined ? { status: toApiProjectStatus(input.status) } : {}),
  });
}

/** Clôture (`completed`) ou suspend (`suspended`) un projet. */
export async function setProjectClosed(
  projectId: number,
  status: 'completed' | 'suspended',
): Promise<void> {
  await projectClient.updateProject(projectId, {
    status: status === 'completed' ? 'Completed' : 'Suspended',
  });
}

function toApiProjectStatus(status: string): 'Active' | 'Suspended' | 'Completed' {
  if (status === 'done') return 'Completed';
  if (status === 'review') return 'Suspended';
  return 'Active';
}

/** Commentaires et historique d'une tâche, tels que Project API les assemble. */
export async function getTaskCollaboration(projectId: number, taskId: number) {
  const { data } = await projectClient.getTaskCollaboration(projectId, taskId);
  return data;
}

/** Ajoute un commentaire signé par l'appelant. */
export async function addTaskComment(
  projectId: number,
  taskId: number,
  _user: ProjectUserContext,
  message: string,
) {
  const { data } = await projectClient.addTaskComment(projectId, taskId, { message });
  return data;
}

/** Consigne une action dans l'historique de la tâche, signée par l'appelant. */
export async function appendTaskHistory(
  projectId: number,
  taskId: number,
  _user: ProjectUserContext,
  action: string,
  label: string,
  changes?: Record<string, unknown>,
): Promise<void> {
  await projectClient.appendTaskHistory(projectId, taskId, {
    action,
    label,
    ...(changes ? { changes } : {}),
  });
}
