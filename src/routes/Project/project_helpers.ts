import { HttpError, upstreamStatus, validationError } from "@mairie360/bffs-lib";
import { z } from "zod";
import { projectApi } from "../../clients/projectClient";
import type {
  CreateProjectResultView,
  CreateProjectView,
  CreateTaskResultView,
  CreateTaskView,
  DynamicTaskField,
  ProjetView,
  TaskPriority as ApiTaskPriority,
  TaskStatus as ApiTaskStatus,
  TaskView,
  User as ApiUser,
} from "@mairie360/project-api-openapi/model";
import {
  Person as PersonSchema,
  ProjectListItem as ProjectListItemSchema,
  ProjectPriority as ProjectPrioritySchema,
  ProjectStatus as ProjectStatusSchema,
  ProjectTask as ProjectTaskSchema,
} from "../../openapi-registry";
import type { ProjectUserContext } from "../../auth/project-user";
import {
  getProjectBundle,
  getProjectPermissions,
  getTaskPermissions,
  projectCall,
  type Caller,
  type ProjectPermissions,
  type TaskPermissions,
} from "../../services/projectData";

export type BffProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type BffProjectPriority = z.infer<typeof ProjectPrioritySchema>;
export type BffPerson = z.infer<typeof PersonSchema>;
export type BffProjectListItem = z.infer<typeof ProjectListItemSchema>;
export type BffProjectTask = z.infer<typeof ProjectTaskSchema>;

// A member's name may be missing in Project API (deleted user): the BFF contract replaces it.
export type User = ApiUser;

/** Body of Project API `PATCH /api/v1/projects/{project_id}/tasks/{task_id}`. */
export interface PatchTaskView {
  name?: string;
  status?: ApiTaskStatus;
  priority?: ApiTaskPriority;
  assigned_to?: number | null;
  due_date?: string;
}

export interface TaskInputLike {
  title: string;
  status: BffProjectStatus;
  priority: BffProjectPriority;
  responsibleId?: string;
  assigneeIds: string[];
  labels: string[];
  dueDate: string;
}

export interface BffCreateProjectInput {
  title: string;
  description: string;
  status: BffProjectStatus;
  priority: BffProjectPriority;
  responsibleId: string;
  assigneeIds: string[];
  labels: string[];
  dueDate: string;
  taskItems?: Array<
    Pick<
      TaskInputLike,
      "title" | "status" | "priority" | "assigneeIds" | "labels" | "dueDate"
    >
  >;
}

export interface BffCreateTaskInput extends TaskInputLike {
  responsibleId: string;
}

export type BffUpdateTaskInput = Partial<BffCreateTaskInput>;

export interface BffUpdateTaskStatusInput {
  status: BffProjectStatus;
}

const projectStatusLabelMap: Record<BffProjectStatus, string> = {
  todo: "À faire",
  "in-progress": "En cours",
  review: "En revue",
  done: "Terminé",
};

const projectPriorityLabelMap: Record<BffProjectPriority, string> = {
  high: "Haute",
  medium: "Moyenne",
  low: "Basse",
};

const backendProjectStatusToBffMap: Record<string, BffProjectStatus> = {
  Active: "in-progress",
  Suspended: "review",
  Completed: "done",
  Error: "todo",
};

const backendTaskStatusToBffMap: Record<string, BffProjectStatus> = {
  Todo: "todo",
  InProgress: "in-progress",
  Completed: "done",
  Error: "review",
};

const bffTaskStatusToBackendMap: Record<BffProjectStatus, ApiTaskStatus> = {
  todo: "Todo",
  "in-progress": "InProgress",
  review: "Error",
  done: "Completed",
};

const backendTaskPriorityToBffMap: Record<string, BffProjectPriority> = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Urgent: "high",
  Error: "medium",
};

const bffTaskPriorityToBackendMap: Record<BffProjectPriority, ApiTaskPriority> =
  {
    low: "Low",
    medium: "Medium",
    high: "High",
  };

function nowIso(): string {
  return new Date().toISOString();
}

/** `project-<id>` path parameter → id, or the 400 of a validation failure on `params.projectId`. */
export function requireProjectIdParam(value: string): number {
  const projectId = parseProjectId(value);
  if (projectId === null) {
    throw validationError("params", [{ path: ["projectId"], message: "projectId must be a project-<id> identifier" }]);
  }
  return projectId;
}

/** `project-<id>` and `task-<id>` path parameters → ids, or the 400 of a validation failure on `params`. */
export function requireTaskParams(params: { projectId: string; taskId: string }): { projectId: number; taskId: number } {
  const projectId = parseProjectId(params.projectId);
  const taskId = parseTaskId(params.taskId);
  if (projectId === null || taskId === null) {
    throw validationError("params", [{ path: [], message: "projectId and taskId must be project-<id> and task-<id> identifiers" }]);
  }
  return { projectId, taskId };
}

export async function fetchProjectUsers(caller: Caller, projectId: number): Promise<User[]> {
  const result = (await projectCall(caller, (options) => projectApi.getProjectUsers(projectId, options), true)).data;

  return result.users;
}

export async function fetchProjectBundle(caller: Caller, projectId: number): Promise<{
  project: ProjetView;
  tasks: TaskView[];
  users: User[];
}> {
  const bundle = await getProjectBundle(caller, projectId);
  if (!bundle) throw new HttpError(404, 'Project not found.');

  return bundle;
}

export async function createProjectOnApi(
  caller: Caller,
  body: CreateProjectView,
): Promise<CreateProjectResultView> {
  const result = (await projectCall(caller, (options) => projectApi.createProject(body, options))).data;

  if (!result || !Number.isInteger(result.project_id) || result.project_id <= 0) {
    throw new HttpError(502, 'Project API answered an invalid body when creating the project.');
  }

  return result;
}

/**
 * Makes the project's members exactly `userIds` (public `user-<id>` ids): adds the missing ones and removes
 * the others. `currentUsers` are the members already read by the caller (a fresh project has none);
 * when omitted they are read from Project API.
 */
export async function syncProjectUsersOnApi(
  caller: Caller,
  projectId: number,
  userIds: string[],
  currentUsers?: User[],
): Promise<void> {
  const desiredUserIds = new Set(
    userIds
      .map((userId) => parseUserId(userId))
      .filter((userId): userId is number => userId !== null),
  );
  const members = currentUsers ?? await fetchProjectUsers(caller, projectId);
  const currentUserIds = new Set(members.map((user) => user.id));

  await Promise.all([
    ...Array.from(desiredUserIds)
      .filter((userId) => !currentUserIds.has(userId))
      .map((userId) => projectCall(caller, (options) => projectApi.addUserToProject(projectId, { user_id: userId }, options))),
    ...members
      .filter((user) => !desiredUserIds.has(user.id))
      .map((user) => projectCall(caller, (options) => projectApi.removeUserFromProject(projectId, user.id, options))),
  ]);
}

/** Adds the given members (public `user-<id>` ids) that are not already in `currentUsers`; removes nobody. */
export async function addProjectUsersOnApi(
  caller: Caller,
  projectId: number,
  userIds: string[],
  currentUsers: User[],
): Promise<void> {
  const currentUserIds = new Set(currentUsers.map((user) => user.id));
  const missing = new Set(
    userIds
      .map((userId) => parseUserId(userId))
      .filter((userId): userId is number => userId !== null && !currentUserIds.has(userId)),
  );
  await Promise.all(Array.from(missing).map((userId) =>
    projectCall(caller, (options) => projectApi.addUserToProject(projectId, { user_id: userId }, options)),
  ));
}

/**
 * Runs the writes that follow the creation of a project; if one fails, deletes the project (best effort)
 * so that a client retrying after the error does not leave a partial duplicate behind, then rethrows.
 */
export async function withCreatedProjectRollback<T>(caller: Caller, projectId: number, steps: () => Promise<T>): Promise<T> {
  try {
    return await steps();
  } catch (error) {
    try {
      await deleteProjectOnApi(caller, projectId);
    } catch (rollbackError) {
      // The id and the status only: the error of the call holds the caller's token and bodies (MAIR-290).
      console.error(`[BFF Project] Could not delete the partially created project ${projectId}`, {
        status: upstreamStatus(rollbackError) ?? "no answer",
      });
    }
    throw error;
  }
}

export async function createTaskOnApi(
  caller: Caller,
  projectId: number,
  body: CreateTaskView,
): Promise<CreateTaskResultView> {
  const result = (await projectCall(caller, (options) => projectApi.createTask(projectId, body, options))).data;
  if (!result || !Number.isInteger(result.task_id) || result.task_id <= 0) {
    throw new HttpError(502, 'Project API answered an invalid body when creating the task.');
  }
  return result;
}

export async function deleteProjectOnApi(caller: Caller, projectId: number): Promise<void> {
  await projectCall(caller, (options) => projectApi.deleteProject(projectId, options));
}

export async function patchTaskOnApi(
  caller: Caller,
  projectId: number,
  taskId: number,
  body: PatchTaskView,
): Promise<void> {
  await projectCall(caller, (options) => projectApi.patchTask(projectId, taskId, body, options));
}

export async function deleteTaskOnApi(
  caller: Caller,
  projectId: number,
  taskId: number,
): Promise<void> {
  await projectCall(caller, (options) => projectApi.deleteTask(projectId, taskId, options));
}

// Public ids are `<prefix>-<digits>` and nothing else: `user-5` is not a project and `abc12` is not 12.
function parsePrefixedId(prefix: "project" | "task" | "user", value: string | undefined): number | null {
  if (!value) return null;
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** `project-<id>` → id, `null` for anything else. */
export function parseProjectId(value: string | undefined): number | null {
  return parsePrefixedId("project", value);
}

/** `task-<id>` → id, `null` for anything else. */
export function parseTaskId(value: string | undefined): number | null {
  return parsePrefixedId("task", value);
}

/** `user-<id>` → id, `null` for anything else. */
export function parseUserId(value: string | undefined): number | null {
  return parsePrefixedId("user", value);
}

export function projectPublicId(projectId: number): string {
  return `project-${projectId}`;
}

export function taskPublicId(taskId: number): string {
  return `task-${taskId}`;
}

export function userPublicId(userId: number): string {
  return `user-${userId}`;
}

export function mapPerson(
  user?: User | null,
  fallbackId = "user-0",
  fallbackName = "Inconnu",
): BffPerson {
  if (!user) {
    return {
      id: fallbackId,
      name: fallbackName,
      avatarUrl: null,
    };
  }

  return {
    id: userPublicId(user.id),
    name: user.name ?? fallbackName,
    avatarUrl: null,
  };
}

export function mapPeople(users: User[] | undefined | null): BffPerson[] {
  return (users ?? []).map((user) => mapPerson(user));
}

export function mapProjectStatus(status: string): BffProjectStatus {
  return backendProjectStatusToBffMap[status] ?? "todo";
}

export function mapTaskStatus(status: string): BffProjectStatus {
  return backendTaskStatusToBffMap[status] ?? "todo";
}

export function mapTaskStatusToBackend(
  status: BffProjectStatus,
): ApiTaskStatus {
  return bffTaskStatusToBackendMap[status];
}

export function mapProjectStatusLabel(status: BffProjectStatus): string {
  return projectStatusLabelMap[status];
}

export function mapTaskStatusLabel(status: BffProjectStatus): string {
  return projectStatusLabelMap[status];
}

export function mapProjectPriorityLabel(priority: BffProjectPriority): string {
  return projectPriorityLabelMap[priority];
}

export function mapTaskPriority(priority: string): BffProjectPriority {
  return backendTaskPriorityToBffMap[priority] ?? "medium";
}

export function mapTaskPriorityLabel(priority: BffProjectPriority): string {
  return projectPriorityLabelMap[priority];
}

function priorityWeight(priority: BffProjectPriority): number {
  switch (priority) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

export function deriveProjectPriority(tasks: TaskView[]): BffProjectPriority {
  if (tasks.length === 0) {
    return "medium";
  }

  const highest = [...tasks]
    .map((task) => mapTaskPriority(task.priority))
    .sort((left, right) => priorityWeight(right) - priorityWeight(left))[0];

  return highest ?? "medium";
}

export function deriveProjectProgress(tasks: TaskView[]): number {
  if (tasks.length === 0) {
    return 0;
  }

  const completed = tasks.filter(
    (task) => mapTaskStatus(task.status) === "done",
  ).length;
  return Math.round((completed / tasks.length) * 100);
}

export function deriveProjectStatus(tasks: TaskView[]): BffProjectStatus {
  if (tasks.length === 0) {
    return "todo";
  }

  const completed = tasks.filter(
    (task) => mapTaskStatus(task.status) === "done",
  ).length;

  if (completed === tasks.length) {
    return "done";
  }

  if (completed > 0) {
    return "in-progress";
  }

  return "todo";
}

export function deriveProjectDueDate(tasks: TaskView[]): string {
  if (tasks.length === 0) {
    return nowIso();
  }

  // A task without a due date (optional in Project API) is sorted last.
  const sorted = [...tasks].sort((left, right) =>
    (left.due_date ?? '').localeCompare(right.due_date ?? ''),
  );
  return sorted.find((task) => task.due_date)?.due_date ?? nowIso();
}

export function mapProjectToDto(
  project: ProjetView,
  tasks: TaskView[],
  users: User[],
  permissions: ProjectPermissions = {
    canView: true,
    canEdit: true,
    canDuplicate: true,
    canDelete: true,
    canCreateTask: true,
    canAssignMembers: true,
    canClose: true,
  },
): BffProjectListItem {
  const status = mapProjectStatus(project.status);
  const priority = deriveProjectPriority(tasks);
  const responsible =
    users.length > 0
      ? mapPerson(users[0])
      : mapPerson(null, projectPublicId(project.id), project.name);
  const assignees =
    users.length > 0 ? users.map((user) => mapPerson(user)) : [responsible];

  return {
    id: projectPublicId(project.id),
    title: project.name,
    description: project.description,
    status,
    statusLabel: mapProjectStatusLabel(status),
    priority,
    priorityLabel: mapProjectPriorityLabel(priority),
    responsible,
    assignees,
    labels: [],
    progress: deriveProjectProgress(tasks),
    dueDate: deriveProjectDueDate(tasks),
    // Project API exposes no creation date: the contract still requires one (see docs, "Data not persisted").
    createdAt: nowIso(),
    tasks: {
      total: tasks.length,
      completed: tasks.filter((task) => mapTaskStatus(task.status) === "done")
        .length,
    },
    permissions,
  };
}

export function mapTaskToDto(
  task: TaskView,
  users: User[],
  permissions: TaskPermissions = {
    canView: true,
    canEdit: true,
    canDelete: true,
    canUpdateStatus: true,
    canComment: true,
  },
): BffProjectTask {
  const status = mapTaskStatus(task.status);
  const responsibleUser =
    users.find((user) => user.id === task.assigned_to) ?? users[0] ?? null;
  const responsible = responsibleUser
    ? mapPerson(responsibleUser)
    : mapPerson(null, taskPublicId(task.id), task.title);
  const assignees = task.assigned_to ? [responsible] : [];
  const priority = mapTaskPriority(task.priority);

  return {
    id: taskPublicId(task.id),
    title: task.title,
    status,
    statusLabel: mapTaskStatusLabel(status),
    responsible,
    assignees,
    priority,
    priorityLabel: mapTaskPriorityLabel(priority),
    labels: [],
    // The BFF contract requires a due date: a task without one shows today's date.
    dueDate: task.due_date ?? nowIso(),
    completed: status === "done",
    // Project API exposes no creation date: the contract still requires one (see docs, "Data not persisted").
    createdAt: nowIso(),
    permissions,
  };
}

export function mapTaskInputToBackend(task: TaskInputLike): CreateTaskView {
  const assignedTo = task.responsibleId
    ? parseUserId(task.responsibleId)
    : null;

  return {
    name: task.title,
    status: bffTaskStatusToBackendMap[task.status],
    priority: bffTaskPriorityToBackendMap[task.priority],
    assigned_to: assignedTo,
    description: null,
    due_date: task.dueDate,
    fields: [
      {
        label: "Date",
        task_type: "date",
        fields_options: [{ option: task.dueDate, is_selected: true }],
      },
      ...task.labels.map(
        (label): DynamicTaskField => ({
          label,
          task_type: "select",
          fields_options: [{ option: label, is_selected: true }],
        }),
      ),
    ],
  };
}

export function mapTaskUpdateBodyToBackend(task: BffUpdateTaskInput): PatchTaskView {
  const body: PatchTaskView = {};

  if (typeof task.title === "string") body.name = task.title;
  if (typeof task.status === "string") body.status = bffTaskStatusToBackendMap[task.status];
  if (typeof task.priority === "string") body.priority = bffTaskPriorityToBackendMap[task.priority];
  if (typeof task.responsibleId === "string") body.assigned_to = parseUserId(task.responsibleId);
  if (typeof task.dueDate === "string") body.due_date = task.dueDate;

  return body;
}

export function mapProjectCreateBodyToBackend(
  body: BffCreateProjectInput,
): CreateProjectView {
  return {
    name: body.title,
    description: body.description,
  };
}

export function collectMembers(usersByProject: User[][]): Array<{
  label: string;
  value: string;
  name: string;
  avatarUrl: string | null;
}> {
  const seen = new Set<string>();
  const members: Array<{
    label: string;
    value: string;
    name: string;
    avatarUrl: string | null;
  }> = [];

  for (const users of usersByProject) {
    for (const user of users) {
      const member = mapPerson(user);
      if (seen.has(member.id)) {
        continue;
      }

      seen.add(member.id);
      members.push({
        label: member.name,
        value: member.id,
        name: member.name,
        avatarUrl: member.avatarUrl,
      });
    }
  }

  return members;
}

export function defaultProjectSummary(projects: BffProjectListItem[]): {
  totalProjects: number;
  projectsByStatus: Record<string, number>;
  projectsByPriority: Record<string, number>;
} {
  const projectsByStatus: Record<string, number> = {
    todo: 0,
    "in-progress": 0,
    review: 0,
    done: 0,
  };

  const projectsByPriority: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const project of projects) {
    projectsByStatus[project.status] =
      (projectsByStatus[project.status] ?? 0) + 1;
    projectsByPriority[project.priority] =
      (projectsByPriority[project.priority] ?? 0) + 1;
  }

  return {
    totalProjects: projects.length,
    projectsByStatus,
    projectsByPriority,
  };
}

export function buildKanbanColumns(projects: BffProjectListItem[]): Array<{
  status: BffProjectStatus;
  label: string;
  projectIds: string[];
  count: number;
}> {
  const statuses: BffProjectStatus[] = [
    "todo",
    "in-progress",
    "review",
    "done",
  ];

  return statuses.map((status) => {
    const projectsForStatus = projects.filter(
      (project) => project.status === status,
    );

    return {
      status,
      label: projectStatusLabelMap[status],
      projectIds: projectsForStatus.map((project) => project.id),
      count: projectsForStatus.length,
    };
  });
}

export function paginateProjects(
  projects: BffProjectListItem[],
  page: number,
  limit: number,
): BffProjectListItem[] {
  const currentPage = Math.max(page, 1);
  const currentLimit = Math.max(limit, 1);
  const start = (currentPage - 1) * currentLimit;
  return projects.slice(start, start + currentLimit);
}

export function buildPagination(
  total: number,
  page: number,
  limit: number,
): {
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
} {
  const currentPage = Math.max(page, 1);
  const currentLimit = Math.max(limit, 1);
  return {
    page: currentPage,
    limit: currentLimit,
    total,
    hasNextPage: currentPage * currentLimit < total,
  };
}

export function buildProjectDtoForUser(
  user: ProjectUserContext,
  project: ProjetView,
  tasks: TaskView[],
  users: User[],
): BffProjectListItem {
  // The project comes from a bundle already read: it is visible to the caller.
  return mapProjectToDto(project, tasks, users, getProjectPermissions(user, true));
}

export function buildTaskDtoForUser(
  user: ProjectUserContext,
  task: TaskView,
  users: User[],
): BffProjectTask {
  return mapTaskToDto(task, users, getTaskPermissions(user, task.assigned_to));
}
