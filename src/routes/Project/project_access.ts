import { HttpError } from '@mairie360/bffs-lib';
import type { TaskView } from '@mairie360/project-api-openapi/model';
import { parseUserId } from './project_helpers';
import { canManageProjects, isGlobalProjectRole, type ProjectUserContext } from '../../auth/project-user';
import {
  getProjectBundle,
  getProjectPermissions,
  getTaskPermissions,
  listAssignableUsers,
  type Caller,
  type ProjectBundle,
  type ProjectPermissions,
  type TaskPermissions,
} from '../../services/projectData';

// Every guard reads the project bundle once and hands it to the route, which reuses it instead of
// reading it again (the session itself is resolved once per request by projectUserContextMiddleware).
// A refused access throws the 403/404 HttpError the route answers (through the app's errorHandler).

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

export function requireManagerRole(user: ProjectUserContext): void {
  if (!canManageProjects(user.role)) {
    throw new HttpError(403, 'The Responsable, Maire or Admin role is required.');
  }
}

export async function requireAssignableUsers(
  caller: Caller,
  user: ProjectUserContext,
  publicUserIds: string[],
): Promise<void> {
  if (isGlobalProjectRole(user.role) || publicUserIds.length === 0) return;

  const assignableUsers = await listAssignableUsers(caller, user);
  const allowedIds = new Set(assignableUsers.map((entry) => entry.id));
  const invalidIds = Array.from(new Set(publicUserIds)).filter((publicId) => {
    const userId = parseUserId(publicId);
    return userId === null || !allowedIds.has(userId);
  });

  if (invalidIds.length > 0) {
    throw new HttpError(403, 'You can only assign agents of your team.');
  }
}

async function loadProjectAccess(caller: Caller, user: ProjectUserContext, projectId: number): Promise<ProjectAccess | null> {
  const bundle = await getProjectBundle(caller, projectId);
  if (!bundle) return null;
  return { user, bundle, permissions: getProjectPermissions(user, true) };
}

export async function requireProjectView(caller: Caller, user: ProjectUserContext, projectId: number): Promise<ProjectAccess> {
  const access = await loadProjectAccess(caller, user, projectId);
  if (!access) throw new HttpError(404, 'Project not found or not visible.');
  return access;
}

export async function requireProjectManagement(caller: Caller, user: ProjectUserContext, projectId: number): Promise<ProjectAccess> {
  const access = await requireProjectView(caller, user, projectId);
  if (!access.permissions.canEdit) throw new HttpError(403, 'You cannot manage this project.');
  return access;
}

/** Reads the bundle once; 404 when the project or the task is unknown or invisible. */
async function loadTaskAccess(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await loadProjectAccess(caller, user, projectId);
  const task = access?.bundle.tasks.find((entry) => entry.id === taskId);
  if (!access || !task) throw new HttpError(404, 'Task not found or not visible.');
  return { ...access, task, taskPermissions: getTaskPermissions(user, task.assigned_to) };
}

export async function requireTaskView(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await loadTaskAccess(caller, user, projectId, taskId);
  if (!access.taskPermissions.canView) throw new HttpError(404, 'Task not found or not visible.');
  return access;
}

export async function requireTaskManagement(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await requireTaskView(caller, user, projectId, taskId);
  if (!access.taskPermissions.canEdit) throw new HttpError(403, 'You cannot edit the content of this task.');
  return access;
}

export async function requireTaskStatusUpdate(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await loadTaskAccess(caller, user, projectId, taskId);
  if (!access.taskPermissions.canUpdateStatus) {
    throw new HttpError(403, 'Only the assigned agent or a manager can change this status.');
  }
  return access;
}

export async function requireTaskComment(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await loadTaskAccess(caller, user, projectId, taskId);
  if (!access.taskPermissions.canComment) throw new HttpError(403, 'You cannot comment on this task.');
  return access;
}
