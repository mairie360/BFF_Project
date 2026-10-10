import type {
  GetProjectsParams, GetProjectsResultView, ProjetView, TaskCollaborationView, TaskView, User,
} from '@mairie360/project-api-openapi/model';
import { asCaller, callUpstream, type UpstreamRequestOptions } from '@mairie360/bffs-lib';
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
  /** Its active tasks: a completed task is archived (MAIR-502) and only counted in `archivedTasks`. */
  tasks: TaskView[];
  users: User[];
  /** Number of its archived (completed) tasks, listed by `listArchivedTasks`. */
  archivedTasks: number;
};

/** Page size asked of Project API's paginated lists: its maximum (a list defaults to 100 items). */
const PAGE_SIZE = 500;

type PageParams = { limit: number; offset: number };
type PageCount = { read: number; total: number };

/**
 * Every page of a Project API list, from offset 0 until each of its lists (`count`) reached its `total`. A page
 * that brings no item ends the loop, so a `total` that shrinks while paging cannot make it spin.
 */
async function readAllPages<P>(fetchPage: (params: PageParams) => Promise<P>, count: (page: P) => PageCount[]): Promise<P[]> {
  const pages: P[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage({ limit: PAGE_SIZE, offset });
    pages.push(page);
    const counts = count(page);
    const read = Math.max(0, ...counts.map((c) => c.read));
    offset += read;
    if (read === 0 || counts.every((c) => offset >= c.total)) return pages;
  }
}

/** Project visible to the caller, or `null` when it does not exist or is not visible to them (404). */
export async function getProjectBundle(caller: Caller, projectId: number): Promise<ProjectBundle | null> {
  const fetchPage = (params: PageParams) => projectCall(caller, async (options) => {
    try {
      return (await projectApi.getProject(projectId, params, options)).data;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) return null;
      throw error;
    }
  }, true);

  const first = await fetchPage({ limit: PAGE_SIZE, offset: 0 });
  if (!first) return null;

  // GET /projects/{id} pages the tasks only; it embeds the first 100 members, the others come from GET …/users/.
  // Once the first page gives the totals, the other task pages and the members are read in parallel (MAIR-474: the
  // 2 000 tasks of a large project took four sequential calls).
  // The pages step by the size Project API actually served, whatever limit it applied.
  const served = first.tasks.length;
  const offsets: number[] = [];
  if (served > 0) {
    for (let offset = served; offset < first.tasks_total; offset += served) offsets.push(offset);
  }
  const [pages, users] = await Promise.all([
    Promise.all(offsets.map((offset) => fetchPage({ limit: PAGE_SIZE, offset }))),
    first.users.length < first.users_total ? listProjectUsers(caller, projectId) : Promise.resolve(first.users),
  ]);
  // A project deleted between two pages ends the list where it stopped.
  const tasks = [...first.tasks];
  for (const page of pages) {
    if (!page || page.tasks.length === 0) break;
    tasks.push(...page.tasks);
  }

  return { project: first.project, tasks, users, archivedTasks: first.tasks_archived };
}

/**
 * One page of the projects visible to the caller that match `params`, with the aggregates of their tasks, their
 * first members and the counts per status and priority of every match (MAIR-474): Project API applies the
 * visibility rules, the filters and the paging, so a page costs one call whatever the number of projects.
 */
export async function listProjectsPage(caller: Caller, params: GetProjectsParams): Promise<GetProjectsResultView> {
  return (await projectCall(caller, (options) => projectApi.getProjects(params, options), true)).data;
}

/**
 * One task of a project visible to the caller, or `null` when the project is not visible or the task is not one of
 * its tasks (404). One call, whatever the number of tasks of the project (MAIR-474).
 */
export async function getProjectTask(caller: Caller, projectId: number, taskId: number): Promise<TaskView | null> {
  return projectCall(caller, async (options) => {
    try {
      return (await projectApi.getTask(projectId, taskId, options)).data;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) return null;
      throw error;
    }
  }, true);
}

/** A task of a project and every member of the project (to name its assignee), read in parallel. */
export async function getTaskWithMembers(
  caller: Caller,
  projectId: number,
  taskId: number,
): Promise<{ task: TaskView; users: User[] } | null> {
  const [task, users] = await Promise.all([getProjectTask(caller, projectId, taskId), listProjectUsers(caller, projectId)]);
  return task ? { task, users } : null;
}

/**
 * One page of the archived tasks of a project (MAIR-502), the most recently archived first, or `null` when the
 * project is unknown or not visible to the caller (404).
 */
export async function listArchivedTasks(
  caller: Caller,
  projectId: number,
  page: { limit: number; offset: number },
): Promise<{ tasks: TaskView[]; total: number } | null> {
  return projectCall(caller, async (options) => {
    try {
      return (await projectApi.getArchivedTasks(projectId, page, options)).data;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) return null;
      throw error;
    }
  }, true);
}

/** Every member of a project. */
export async function listProjectUsers(caller: Caller, projectId: number): Promise<User[]> {
  const pages = await readAllPages(
    async (params) => (await projectCall(caller, (options) => projectApi.getProjectUsers(projectId, params, options), true)).data,
    (page) => [{ read: page.users.length, total: page.total }],
  );
  return pages.flatMap((page) => page.users);
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

/** Comments and history of a task, as Project API assembles them (every page of both lists). */
/**
 * Page `page` (from 1) of the follow-up of a task (MAIR-502): its `limit` most recent comments, put back in reading
 * order (oldest first), and its `limit` most recent history entries (newest first), with both totals. One Project API
 * call: `comments_order=latest` pages the comments from the most recent one, like the history.
 */
export async function getTaskCollaboration(
  caller: Caller,
  projectId: number,
  taskId: number,
  page = 1,
  limit = 50,
): Promise<TaskCollaborationView> {
  const data = await projectCall(
    caller,
    async (options) => (await projectApi.getTaskCollaboration(
      projectId,
      taskId,
      { limit, offset: (page - 1) * limit, comments_order: 'latest' },
      options,
    )).data,
    true,
  );
  return { ...data, comments: [...data.comments].reverse() };
}

/** Adds a comment signed by the caller (Project API reads the author from the forwarded session). */
export async function addTaskComment(caller: Caller, projectId: number, taskId: number, message: string) {
  const { data } = await projectCall(caller, (options) => projectApi.addTaskComment(projectId, taskId, { message }, options));
  return data;
}
