import { HttpError } from '@mairie360/bffs-lib';
import type { TaskView } from '@mairie360/project-api-openapi/model';
import { parseUserId } from './project_helpers';
import { canManageProjects, isGlobalProjectRole, type ProjectUserContext } from '../../auth/project-user';
import {
  callerProjectRights,
  getProjectBundle,
  getProjectTask,
  getProjectPermissions,
  getTaskPermissions,
  isProjectClosed,
  listAssignableUsers,
  PROJECT_CLOSED_MESSAGE,
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
  /** The project is closed (`Completed`): read-only until one of its managers reopens it. */
  closed: boolean;
};

/** What a task guard resolved: the caller, the task and the caller's rights on its project and on it. */
export type TaskAccess = {
  user: ProjectUserContext;
  permissions: ProjectPermissions;
  task: TaskView;
  taskPermissions: TaskPermissions;
  /** Whether the caller manages the task's project (their role, or Project API's `can_manage`, MAIR-1088). */
  projectCanManage: boolean;
  /** The task's project is closed: its tasks are read-only. */
  projectClosed: boolean;
};

/** The `409` of a write on a closed project, worded like Project API's. */
export function projectClosedError(): HttpError {
  return new HttpError(409, PROJECT_CLOSED_MESSAGE);
}

export function requireManagerRole(user: ProjectUserContext): void {
  if (!canManageProjects(user.role)) {
    throw new HttpError(403, 'The Responsable, Maire or Admin role is required.');
  }
}

/**
 * Refuses (403) agents the caller may not assign: the agents of their team (`listAssignableUsers`), plus, when given,
 * the current members of the project (`projectMembers`, read only if needed): a member who manages the project
 * (MAIR-1088) assigns its members whatever their team.
 */
export async function requireAssignableUsers(
  caller: Caller,
  user: ProjectUserContext,
  publicUserIds: string[],
  projectMembers?: () => Promise<number[]>,
): Promise<void> {
  if (isGlobalProjectRole(user.role) || publicUserIds.length === 0) return;

  const assignableUsers = await listAssignableUsers(caller, user);
  const allowedIds = new Set(assignableUsers.map((entry) => entry.id));
  const outside = (ids: Set<number>) => Array.from(new Set(publicUserIds)).filter((publicId) => {
    const userId = parseUserId(publicId);
    return userId === null || !ids.has(userId);
  });
  let invalidIds = outside(allowedIds);
  if (invalidIds.length > 0 && projectMembers) {
    for (const id of await projectMembers()) allowedIds.add(id);
    invalidIds = outside(allowedIds);
  }

  if (invalidIds.length > 0) {
    throw new HttpError(403, 'You can only assign agents of your team.');
  }
}

async function loadProjectAccess(caller: Caller, user: ProjectUserContext, projectId: number): Promise<ProjectAccess | null> {
  const bundle = await getProjectBundle(caller, projectId);
  if (!bundle) return null;
  const closed = isProjectClosed(bundle.project);
  return { user, bundle, permissions: getProjectPermissions(user, true, bundle.project.can_manage, closed), closed };
}

export async function requireProjectView(caller: Caller, user: ProjectUserContext, projectId: number): Promise<ProjectAccess> {
  const access = await loadProjectAccess(caller, user, projectId);
  if (!access) throw new HttpError(404, 'Project not found or not visible.');
  return access;
}

/**
 * The managers of a project, closed or not: what they may still do on a closed project (delete, duplicate, close
 * again, reopen). Every other write goes through `requireOpenProjectManagement`.
 */
export async function requireProjectManagement(caller: Caller, user: ProjectUserContext, projectId: number): Promise<ProjectAccess> {
  const access = await requireProjectView(caller, user, projectId);
  if (!access.permissions.canDelete) throw new HttpError(403, 'You cannot manage this project.');
  return access;
}

/** The managers of a project that is not closed: `409` once the rights are granted on a closed project. */
export async function requireOpenProjectManagement(caller: Caller, user: ProjectUserContext, projectId: number): Promise<ProjectAccess> {
  const access = await requireProjectManagement(caller, user, projectId);
  if (access.closed) throw projectClosedError();
  return access;
}

/**
 * Reads the task alone (MAIR-474: not every task of its project); 404 when the project is unknown or invisible, or
 * the task is not one of its tasks. Project API answers it only when the project is visible to the caller.
 */
async function loadTaskAccess(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  // A manager role needs no project read; another caller may still manage it as a `manager` member (MAIR-1088).
  // The project is read with a single task whatever the role: whether it is closed decides the writes.
  const [task, rights] = await Promise.all([
    getProjectTask(caller, projectId, taskId),
    callerProjectRights(caller, user, projectId),
  ]);
  if (!task) throw new HttpError(404, 'Task not found or not visible.');
  return {
    user,
    permissions: getProjectPermissions(user, true, rights.canManage, rights.closed),
    task,
    taskPermissions: getTaskPermissions(user, task.assigned_to, rights.canManage, rights.closed),
    projectCanManage: rights.canManage,
    projectClosed: rights.closed,
  };
}

export async function requireTaskView(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await loadTaskAccess(caller, user, projectId, taskId);
  if (!access.taskPermissions.canView) throw new HttpError(404, 'Task not found or not visible.');
  return access;
}

export async function requireTaskManagement(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await requireTaskView(caller, user, projectId, taskId);
  if (!access.projectCanManage) throw new HttpError(403, 'You cannot edit the content of this task.');
  if (access.projectClosed) throw projectClosedError();
  return access;
}

export async function requireTaskStatusUpdate(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await loadTaskAccess(caller, user, projectId, taskId);
  if (!access.projectCanManage && access.task.assigned_to !== user.id) {
    throw new HttpError(403, 'Only the assigned agent or a manager can change this status.');
  }
  if (access.projectClosed) throw projectClosedError();
  return access;
}

export async function requireTaskComment(caller: Caller, user: ProjectUserContext, projectId: number, taskId: number): Promise<TaskAccess> {
  const access = await loadTaskAccess(caller, user, projectId, taskId);
  if (!access.projectCanManage && access.task.assigned_to !== user.id) {
    throw new HttpError(403, 'You cannot comment on this task.');
  }
  if (access.projectClosed) throw projectClosedError();
  return access;
}
