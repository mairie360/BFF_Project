import type { ProjetView, TaskView, User } from '@mairie360/project-api-openapi/model';
import { HttpError, asCaller, callUpstream, type UpstreamRequestOptions } from '@mairie360/bffs-lib';
import { isAxiosError } from 'axios';
import type { Request } from 'express';
import { projectApi } from '../clients/projectClient';
import { coreApi } from '../clients/coreClient';
import {
  canManageProjects,
  isGlobalProjectRole,
  type ProjectUserContext,
} from '../auth/project-user';

// Every project datum comes from Project API (contract @mairie360/project-api-openapi) and the directory of
// agents from Core API: the BFF reads no database.

/** Timeout of the Project API and Core API calls, in ms. */
const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * The session-bound request an upstream call is made for (its Bearer token is forwarded) and the error
 * statuses its route declares: an upstream 4xx is relayed only when declared, anything else becomes a 502.
 */
export interface Caller {
  readonly req: Pick<Request, 'headers'>;
  readonly declared: readonly number[];
}

export function callerOf(req: Pick<Request, 'headers'>, declared: readonly number[]): Caller {
  return { req, declared };
}

type Call<T> = (options: UpstreamRequestOptions) => Promise<T>;

/**
 * A Project API call on behalf of `caller`: 401 without a session, 503 when PROJECT_API_URL is missing, the
 * declared upstream 4xx relayed, anything else 502. `retry` only for idempotent reads.
 */
export function projectCall<T>(caller: Caller, call: Call<T>, retry = false): Promise<T> {
  return callUpstream('PROJECT_API', () => call(asCaller('PROJECT_API', caller.req, UPSTREAM_TIMEOUT_MS)), {
    declared: caller.declared,
    retry,
  });
}

function coreCall<T>(caller: Caller, call: Call<T>, retry = false): Promise<T> {
  return callUpstream('CORE_API', () => call(asCaller('CORE_API', caller.req, UPSTREAM_TIMEOUT_MS)), {
    declared: caller.declared,
    retry,
  });
}

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

/** Project visible to the caller, or `null` when it does not exist or is not visible to them (404). */
export async function getProjectBundle(caller: Caller, projectId: number): Promise<ProjectBundle | null> {
  const data = await projectCall(caller, async (options) => {
    try {
      return (await projectApi.getProject(projectId, options)).data;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) return null;
      throw error;
    }
  }, true);
  return data && { project: data.project, tasks: data.tasks, users: data.users };
}

/** Projects visible to the caller (Project API applies the visibility rules). */
export async function listVisibleProjects(caller: Caller): Promise<ProjetView[]> {
  const { data } = await projectCall(caller, (options) => projectApi.getProjects(options), true);
  return data.projects;
}

/** Rights on a project the caller can see (`visible`): managing it needs a manager role. */
export function getProjectPermissions(user: ProjectUserContext, visible: boolean): ProjectPermissions {
  const canManage = visible && canManageProjects(user.role);

  return {
    canView: visible,
    canEdit: canManage,
    canDuplicate: canManage,
    canDelete: canManage,
    canCreateTask: canManage,
    canAssignMembers: canManage,
    canClose: canManage,
  };
}

/** Rights on a task of a project the caller can see, given the agent it is assigned to. */
export function getTaskPermissions(user: ProjectUserContext, assignedUserId: number | null | undefined): TaskPermissions {
  const canManage = getProjectPermissions(user, true).canEdit;
  const assignedToCurrentUser = assignedUserId === user.id;

  return {
    canView: canManage || assignedToCurrentUser,
    canEdit: canManage,
    canDelete: canManage,
    canUpdateStatus: canManage || assignedToCurrentUser,
    canComment: canManage || assignedToCurrentUser,
  };
}

/** Non-archived agents of the Core directory, optionally restricted to some groups. */
async function listDirectoryUsers(caller: Caller, groupIds: number[] = []) {
  const { data } = await coreCall(caller, (options) => coreApi.listDirectoryUsers(
    groupIds.length ? { group_ids: groupIds.join(',') } : {},
    options,
  ), true);
  return data.users;
}

/**
 * Agents the caller may assign: everyone for an Admin or a Maire, the members of their groups for a
 * Responsable, themselves otherwise.
 */
export async function listAssignableUsers(caller: Caller, user: ProjectUserContext): Promise<User[]> {
  if (isGlobalProjectRole(user.role)) {
    return toApiUsers(await listDirectoryUsers(caller));
  }

  if (user.role === 'Responsable') {
    const groupIds = user.groups.map((group) => group.id).filter((id): id is number => id !== undefined);
    return groupIds.length > 0 ? toApiUsers(await listDirectoryUsers(caller, groupIds)) : selfOnly(user);
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

/** Updates the title, the description and/or the status of a project. */
export async function updateProjectRecord(
  caller: Caller,
  projectId: number,
  input: { title?: string; description?: string; status?: string },
): Promise<void> {
  await projectCall(caller, (options) => projectApi.updateProject(projectId, {
    ...(input.title !== undefined ? { name: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status !== undefined ? { status: toApiProjectStatus(input.status) } : {}),
  }, options));
}

/** Closes (`completed`) or suspends (`suspended`) a project. */
export async function setProjectClosed(
  caller: Caller,
  projectId: number,
  status: 'completed' | 'suspended',
): Promise<void> {
  await projectCall(caller, (options) => projectApi.updateProject(projectId, {
    status: status === 'completed' ? 'Completed' : 'Suspended',
  }, options));
}

function toApiProjectStatus(status: string): 'Active' | 'Suspended' | 'Completed' {
  if (status === 'done') return 'Completed';
  if (status === 'review') return 'Suspended';
  return 'Active';
}

/** Comments and history of a task, as Project API assembles them. */
export async function getTaskCollaboration(caller: Caller, projectId: number, taskId: number) {
  const { data } = await projectCall(caller, (options) => projectApi.getTaskCollaboration(projectId, taskId, options), true);
  return data;
}

/** Adds a comment signed by the caller (Project API reads the author from the forwarded session). */
export async function addTaskComment(caller: Caller, projectId: number, taskId: number, message: string) {
  const { data } = await projectCall(caller, (options) => projectApi.addTaskComment(projectId, taskId, { message }, options));
  return data;
}

/**
 * Records an action in the history of the task, signed by the caller.
 *
 * Project API >= MAIR-393 writes the history itself (database trigger) and removed this endpoint: its 404 is
 * expected there and ignored. Drop this call once the BFF moves to the project-api-openapi release of MAIR-393.
 */
export async function appendTaskHistory(
  caller: Caller,
  projectId: number,
  taskId: number,
  action: string,
  label: string,
  changes?: Record<string, unknown>,
): Promise<void> {
  try {
    await projectCall({ ...caller, declared: [...caller.declared, 404] }, (options) => projectApi.appendTaskHistory(projectId, taskId, {
      action,
      label,
      ...(changes ? { changes } : {}),
    }, options));
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return;
    throw error;
  }
}
