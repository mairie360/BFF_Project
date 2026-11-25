import type {
  ActivityItemView, BulkDeleteResultItem, CreateMilestoneView, GetProjectsParams, ProjectMemberRole, GetProjectsResultView, MilestoneView, PatchMilestoneView, ProjectStatus, ProjetView, TaskCollaborationView, TaskPriority, TaskView, User,
} from '@mairie360/project-api-openapi/model';
import {
  asCaller, callUpstream, DEFAULT_CONCURRENCY, HttpError, mapWithConcurrency, readOffsetPages, type UpstreamRequestOptions,
} from '@mairie360/bffs-lib';
import { isAxiosError } from 'axios';
import type { Request } from 'express';
import { projectApi } from '../clients/projectClient';
import { coreApi } from '../clients/coreClient';
import {
  canManageProjects,
  isGlobalProjectRole,
  type ProjectUserContext,
  type ProjectUserProfile,
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
  }).catch((error: unknown) => {
    throw isProjectClosedRefusal(error) ? new HttpError(409, PROJECT_CLOSED_MESSAGE, { cause: error }) : error;
  });
}

/**
 * A relayed `409` whose Project API body is `Project is closed.`: its message is kept (a relayed error otherwise gets
 * a generic one), so that the fronts tell a closed project from the other conflicts.
 */
function isProjectClosedRefusal(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 409) return false;
  const upstream = (error as { cause?: unknown }).cause;
  return isAxiosError(upstream) && upstream.response?.data === PROJECT_CLOSED_MESSAGE;
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
  /** A closed project only: whether the caller may reopen it (its managers). */
  canReopen: boolean;
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
  /** Its first 100 milestones (MAIR-1086), by due date, and their total (`listProjectMilestones` pages them all). */
  milestones: MilestoneView[];
  milestonesTotal: number;
};

/** Page size asked of Project API's paginated lists: its maximum (a list defaults to 100 items). */
const PAGE_SIZE = 500;

type PageParams = { limit: number; offset: number };

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
    mapWithConcurrency(offsets, DEFAULT_CONCURRENCY, (offset) => fetchPage({ limit: PAGE_SIZE, offset })),
    first.users.length < first.users_total ? listProjectUsers(caller, projectId) : Promise.resolve(first.users),
  ]);
  // A project deleted between two pages ends the list where it stopped.
  const tasks = [...first.tasks];
  for (const page of pages) {
    if (!page || page.tasks.length === 0) break;
    tasks.push(...page.tasks);
  }

  return {
    project: first.project,
    tasks,
    users,
    archivedTasks: first.tasks_archived,
    milestones: first.milestones,
    milestonesTotal: first.milestones_total,
  };
}

/** Body of the `409` answered for a write on a closed project, as Project API words it. */
export const PROJECT_CLOSED_MESSAGE = 'Project is closed.';

/** Whether a project is closed (`Completed`): read-only until one of its managers reopens it. */
export function isProjectClosed(project: Pick<ProjetView, 'status'>): boolean {
  return project.status === 'Completed';
}

/** The caller's rights on a project they see, and whether it is closed. */
export type ProjectRights = { canManage: boolean; closed: boolean };

/**
 * Whether the caller manages a project (MAIR-1088: their role, or else Project API's `can_manage` for them, a member
 * with the `manager` role or the owner) and whether it is closed, read with a single task. A project that is not
 * visible reads as open and unmanaged (the caller's other reads answer its 404). A manager role skips the read unless
 * `readClosed` asks for the closed state, which then reads as open.
 */
export async function callerProjectRights(
  caller: Caller, user: ProjectUserContext, projectId: number, readClosed = false,
): Promise<ProjectRights> {
  const byRole = canManageProjects(user.role);
  // A manager role needs no read to manage a task; whether the project is closed is then left to Project API, whose
  // `409 Project is closed.` the task routes relay.
  if (byRole && !readClosed) return { canManage: true, closed: false };
  return projectCall(caller, async (options) => {
    try {
      const { project } = (await projectApi.getProject(projectId, { limit: 1, offset: 0 }, options)).data;
      return { canManage: byRole || project.can_manage, closed: isProjectClosed(project) };
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) return { canManage: byRole, closed: false };
      throw error;
    }
  }, true);
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

/**
 * Every member of a project: the first page gives the total, the other pages are then read in parallel (MAIR-525),
 * stepping by the size Project API actually served.
 */
export async function listProjectUsers(caller: Caller, projectId: number): Promise<User[]> {
  const pages = await readOffsetPages({
    fetchPage: async (offset) => (
      await projectCall(caller, (options) => projectApi.getProjectUsers(projectId, { limit: PAGE_SIZE, offset }, options), true)
    ).data,
    served: (page) => page.users.length,
    total: (page) => page.total,
  });
  return pages.flatMap((page) => page.users);
}

/** One page of the milestones of a project (MAIR-1086), by due date then id; deleted ones are left out. */
export async function listProjectMilestones(
  caller: Caller,
  projectId: number,
  page: PageParams,
): Promise<{ milestones: MilestoneView[]; total: number }> {
  return (await projectCall(caller, (options) => projectApi.getProjectMilestones(projectId, page, options), true)).data;
}

/** Adds a milestone to a project (managers; Project API answers the created row). */
export async function createProjectMilestone(caller: Caller, projectId: number, body: CreateMilestoneView): Promise<MilestoneView> {
  return (await projectCall(caller, (options) => projectApi.createProjectMilestone(projectId, body, options))).data;
}

/** Changes the sent fields of a milestone (managers; 404 for a milestone of another project or a deleted one). */
export async function updateProjectMilestone(
  caller: Caller,
  projectId: number,
  milestoneId: number,
  body: PatchMilestoneView,
): Promise<MilestoneView> {
  return (await projectCall(caller, (options) => projectApi.updateProjectMilestone(projectId, milestoneId, body, options))).data;
}

/** Deletes a milestone (soft delete in Project API; 404 for an unknown one). */
export async function deleteProjectMilestone(caller: Caller, projectId: number, milestoneId: number): Promise<void> {
  await projectCall(caller, (options) => projectApi.deleteProjectMilestone(projectId, milestoneId, options));
}

/** Adds a member to a project, with a role (MAIR-1088; absent, Project API makes them a contributor). */
export async function addProjectMember(caller: Caller, projectId: number, userId: number, role?: ProjectMemberRole): Promise<void> {
  await projectCall(caller, (options) => projectApi.addUserToProject(projectId, { user_id: userId, ...(role ? { role } : {}) }, options));
}

/** Changes the role of a member (MAIR-1088): 404 for a user who is not a member, 409 for the owner. */
export async function updateProjectMemberRole(caller: Caller, projectId: number, userId: number, role: ProjectMemberRole): Promise<void> {
  await projectCall(caller, (options) => projectApi.updateMemberRole(projectId, userId, { role }, options));
}

/** Removes a member from a project (MAIR-1088: 409 for the owner). */
export async function removeProjectMember(caller: Caller, projectId: number, userId: number): Promise<void> {
  await projectCall(caller, (options) => projectApi.removeUserFromProject(projectId, userId, options));
}

/** One page of the activity of a project (MAIR-1089): its comments and the history of its tasks, newest first. */
export async function listProjectActivity(
  caller: Caller,
  projectId: number,
  page: PageParams,
): Promise<{ items: ActivityItemView[]; total: number }> {
  return (await projectCall(caller, (options) => projectApi.getProjectActivity(projectId, page, options), true)).data;
}

/** Adds a comment to a project, signed by the caller (any viewer, MAIR-1089); Project API answers the activity item. */
export async function addProjectComment(caller: Caller, projectId: number, message: string): Promise<ActivityItemView> {
  return (await projectCall(caller, (options) => projectApi.addProjectComment(projectId, { message }, options))).data;
}

/** Deletes projects one by one in Project API (MAIR-1089), each with the rule of a single deletion. */
export async function bulkDeleteProjects(caller: Caller, ids: number[]): Promise<BulkDeleteResultItem[]> {
  return (await projectCall(caller, (options) => projectApi.bulkDeleteProjects({ ids }, options))).data.results;
}

/**
 * Rights on a project the caller can see (`visible`): managing it needs a manager role, or Project API's `can_manage`
 * for the caller (`apiCanManage`, MAIR-1088: its owner or a member with the `manager` role manages it too).
 * A closed project (`closed`) is read-only: its managers may still duplicate, delete or reopen it, nothing else.
 */
export function getProjectPermissions(
  user: ProjectUserContext,
  visible: boolean,
  apiCanManage = false,
  closed = false,
): ProjectPermissions {
  const canManage = visible && (canManageProjects(user.role) || apiCanManage);
  const canWrite = canManage && !closed;

  return {
    canView: visible,
    canEdit: canWrite,
    canDuplicate: canManage,
    canDelete: canManage,
    canCreateTask: canWrite,
    canAssignMembers: canWrite,
    canClose: canWrite,
    canReopen: canManage && closed,
  };
}

/**
 * Rights on a task of a project the caller can see, given the agent it is assigned to and whether Project API lets the
 * caller manage the project (`apiCanManage`, MAIR-1088). The task of a closed project (`projectClosed`) is read-only.
 */
export function getTaskPermissions(
  user: ProjectUserContext,
  assignedUserId: number | null | undefined,
  apiCanManage = false,
  projectClosed = false,
): TaskPermissions {
  const canManage = getProjectPermissions(user, true, apiCanManage).canEdit;
  const assignedToCurrentUser = assignedUserId === user.id;
  const canWrite = !projectClosed;

  return {
    canView: canManage || assignedToCurrentUser,
    canEdit: canWrite && canManage,
    canDelete: canWrite && canManage,
    canUpdateStatus: canWrite && (canManage || assignedToCurrentUser),
    canComment: canWrite && (canManage || assignedToCurrentUser),
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

/** An agent the caller may assign: their Core id and name. */
export type AssignableUser = { id: number; name?: string | null };

/**
 * Agents the caller may assign: everyone for an Admin or a Maire, the members of their groups for a
 * Responsable, themselves otherwise.
 */
export async function listAssignableUsers(caller: Caller, user: ProjectUserContext): Promise<AssignableUser[]> {
  if (isGlobalProjectRole(user.role)) {
    return toApiUsers(await listDirectoryUsers(caller));
  }

  // Only these roles need the caller's Core profile (groups, name): read once, and only here (MAIR-525).
  const profile = await user.profile();
  if (user.role === 'Responsable') {
    const groupIds = profile.groups.map((group) => group.id).filter((id): id is number => id !== undefined);
    return groupIds.length > 0 ? toApiUsers(await listDirectoryUsers(caller, groupIds)) : selfOnly(user, profile);
  }

  return selfOnly(user, profile);
}

function selfOnly(user: ProjectUserContext, profile: ProjectUserProfile): AssignableUser[] {
  return [{ id: user.id, name: profile.name }];
}

function toApiUsers(users: Array<{ id: number; first_name: string; last_name: string }>): AssignableUser[] {
  return users.map((user) => ({
    id: user.id,
    name: `${user.first_name} ${user.last_name}`.trim(),
  }));
}

/** Updates the title, the description, the status, the priority (both stored, MAIR-558), the group and/or the budget of a project. */
export async function updateProjectRecord(
  caller: Caller,
  projectId: number,
  input: {
    title?: string;
    description?: string;
    status?: ProjectStatus;
    priority?: TaskPriority;
    groupId?: number;
    /** In cents of euro (MAIR-1085): absent keeps it, `null` clears it. */
    budgetVoted?: number | null;
    budgetCommitted?: number | null;
    /** The responsible Project API records (and makes a `manager` member); absent keeps it. */
    responsibleId?: number;
    /** The deadline of the project (`YYYY-MM-DD`); absent keeps it. */
    deadline?: string;
  },
): Promise<void> {
  await projectCall(caller, (options) => projectApi.updateProject(projectId, {
    // Absent, the group is kept.
    ...(input.groupId !== undefined ? { group_id: input.groupId } : {}),
    ...(input.title !== undefined ? { name: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.budgetVoted !== undefined ? { budget_voted: input.budgetVoted } : {}),
    ...(input.budgetCommitted !== undefined ? { budget_committed: input.budgetCommitted } : {}),
    ...(input.responsibleId !== undefined ? { responsible_id: input.responsibleId } : {}),
    ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
  }, options));
}

/** Closes (`Completed`), puts on hold (`Suspended`, MAIR-1084) or in review (`Review`) a project. */
export async function setProjectClosed(
  caller: Caller,
  projectId: number,
  status: 'Completed' | 'Suspended' | 'Review',
): Promise<void> {
  // Closing goes through Project API's close route, which also answers 200 for a project already closed: its PATCH
  // refuses any write on a closed project with a 409, closing it again included.
  if (status === 'Completed') {
    await projectCall(caller, (options) => projectApi.closeProject(projectId, options));
    return;
  }
  await projectCall(caller, (options) => projectApi.updateProject(projectId, { status }, options));
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
