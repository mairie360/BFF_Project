import type { Response } from 'express';
import type { TaskView } from '@mairie360/project-api-openapi/model';
import { parseUserId, sendError } from './project_helpers';
import { canManageProjects, getProjectUserContext, isGlobalProjectRole, type ProjectUserContext } from '../../auth/project-user';
import {
  getProjectBundle,
  getProjectPermissions,
  getTaskPermissions,
  listAssignableUsers,
  type ProjectBundle,
  type ProjectPermissions,
  type TaskPermissions,
} from '../../services/projectData';

// Every guard reads the project bundle once and hands it to the route, which reuses it instead of
// reading it again (the session itself is resolved once per request by projectUserContextMiddleware).

/** What a project guard resolved: the caller, the bundle it read and the caller's rights on it. */
export type ProjectAccess = {
  user: ProjectUserContext;
  bundle: ProjectBundle;
  permissions: ProjectPermissions;
};

/** What a task guard resolved: the project access plus the task and the caller's rights on it. */
export type TaskAccess = ProjectAccess & {
  task: TaskView;
  taskPermissions: TaskPermissions;
};

function sendAccessError(res: Response, status: 403 | 404, message: string): null {
  sendError(res, status, message);
  return null;
}

export function requireManagerRole(res: Response): ProjectUserContext | null {
  const user = getProjectUserContext(res);
  if (!canManageProjects(user.role)) {
    return sendAccessError(res, 403, 'The Responsable, Maire or Admin role is required.');
  }
  return user;
}

export async function requireAssignableUsers(
  res: Response,
  user: ProjectUserContext,
  publicUserIds: string[],
): Promise<boolean> {
  if (isGlobalProjectRole(user.role) || publicUserIds.length === 0) return true;

  const assignableUsers = await listAssignableUsers(user);
  const allowedIds = new Set(assignableUsers.map((entry) => entry.id));
  const invalidIds = Array.from(new Set(publicUserIds)).filter((publicId) => {
    const userId = parseUserId(publicId);
    return userId === null || !allowedIds.has(userId);
  });

  if (invalidIds.length > 0) {
    sendAccessError(res, 403, 'You can only assign agents of your team.');
    return false;
  }

  return true;
}

async function loadProjectAccess(res: Response, projectId: number): Promise<ProjectAccess | null> {
  const user = getProjectUserContext(res);
  const bundle = await getProjectBundle(projectId);
  if (!bundle) return null;
  return { user, bundle, permissions: await getProjectPermissions(user, projectId, true) };
}

export async function requireProjectView(res: Response, projectId: number): Promise<ProjectAccess | null> {
  const access = await loadProjectAccess(res, projectId);
  if (!access) {
    return sendAccessError(res, 404, 'Project not found or not visible.');
  }
  return access;
}

export async function requireProjectManagement(res: Response, projectId: number): Promise<ProjectAccess | null> {
  const access = await requireProjectView(res, projectId);
  if (!access) return null;
  if (!access.permissions.canEdit) {
    return sendAccessError(res, 403, 'You cannot manage this project.');
  }
  return access;
}

/** Reads the bundle once; `null` (after a 404) when the project or the task is unknown or invisible. */
async function loadTaskAccess(res: Response, projectId: number, taskId: number): Promise<TaskAccess | null> {
  const access = await loadProjectAccess(res, projectId);
  const task = access?.bundle.tasks.find((entry) => entry.id === taskId);
  if (!access || !task) {
    return sendAccessError(res, 404, 'Task not found or not visible.');
  }
  const taskPermissions = await getTaskPermissions(access.user, projectId, taskId, task.assigned_to ?? null);
  return { ...access, task, taskPermissions };
}

export async function requireTaskView(res: Response, projectId: number, taskId: number): Promise<TaskAccess | null> {
  const access = await loadTaskAccess(res, projectId, taskId);
  if (!access) return null;
  if (!access.taskPermissions.canView) {
    return sendAccessError(res, 404, 'Task not found or not visible.');
  }
  return access;
}

export async function requireTaskManagement(res: Response, projectId: number, taskId: number): Promise<TaskAccess | null> {
  const access = await requireTaskView(res, projectId, taskId);
  if (!access) return null;
  if (!access.taskPermissions.canEdit) {
    return sendAccessError(res, 403, 'You cannot edit the content of this task.');
  }
  return access;
}

export async function requireTaskStatusUpdate(res: Response, projectId: number, taskId: number): Promise<TaskAccess | null> {
  const access = await loadTaskAccess(res, projectId, taskId);
  if (!access) return null;
  if (!access.taskPermissions.canUpdateStatus) {
    return sendAccessError(res, 403, 'Only the assigned agent or a manager can change this status.');
  }
  return access;
}

export async function requireTaskComment(res: Response, projectId: number, taskId: number): Promise<TaskAccess | null> {
  const access = await loadTaskAccess(res, projectId, taskId);
  if (!access) return null;
  if (!access.taskPermissions.canComment) {
    return sendAccessError(res, 403, 'You cannot comment on this task.');
  }
  return access;
}
