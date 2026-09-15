import type { Response } from "express";
import axios from "axios";
import { z } from "zod";
import projectClient, { projectApiAxios } from "../../clients/projectClient";
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
  createTaskRecord,
  deleteProjectRecord,
  deleteTaskRecord,
  getProjectBundleFromDatabase,
  getProjectPermissions,
  getTaskPermissions,
  isProjectDatabaseAccessEnabled,
  listVisibleProjectRows,
  syncProjectMembers,
  updateTaskRecord,
  type ProjectPermissions,
  type TaskPermissions,
} from "../../repositories/projectRepository";

export type BffProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type BffProjectPriority = z.infer<typeof ProjectPrioritySchema>;
export type BffPerson = z.infer<typeof PersonSchema>;
export type BffProjectListItem = z.infer<typeof ProjectListItemSchema>;
export type BffProjectTask = z.infer<typeof ProjectTaskSchema>;

// Project_API 0.4.1 n'expose plus que l'id ; le nom vient de la base quand elle est accessible.
export type User = ApiUser & { name?: string };

// Project_API 0.4.1 ne publie plus PATCH /tasks/{task_id} : payload conservé pour le mode base de données.
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

export interface BffUpdateProjectInput extends Partial<
  Omit<BffCreateProjectInput, "taskItems">
> {
  taskItems?: BffCreateProjectInput["taskItems"];
}

export interface BffCreateTaskInput extends TaskInputLike {
  responsibleId: string;
}

export type BffUpdateTaskInput = Partial<BffCreateTaskInput>;

export interface BffUpdateTaskStatusInput {
  status: BffProjectStatus;
}

class UpstreamApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = "UpstreamApiError";
  }
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

function mapStatusCode(status: number): number {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 501) {
    return status;
  }

  if (status >= 500) {
    return 502;
  }

  return 500;
}

function mapErrorCode(status: number): string {
  if (status === 400) {
    return "BAD_REQUEST";
  }

  if (status === 401) {
    return "UNAUTHORIZED";
  }

  if (status === 403) {
    return "FORBIDDEN";
  }

  if (status === 404) {
    return "NOT_FOUND";
  }

  if (status === 501) {
    return "NOT_IMPLEMENTED";
  }

  if (status >= 500) {
    return "BAD_GATEWAY";
  }

  return "INTERNAL_SERVER_ERROR";
}

// Messages génériques par statut : ni le corps de Project API ni le détail réseau (hôte, port) ne sont renvoyés.
const upstreamErrorMessages: Record<number, string> = {
  400: "La requête a été refusée par Project API.",
  401: "La session a été refusée par Project API.",
  403: "Accès refusé par Project API.",
  404: "Ressource introuvable dans Project API.",
  500: "Project API a renvoyé une réponse inattendue.",
  501: "Opération non disponible dans Project API.",
  502: "Project API est indisponible.",
};

function isUpstreamApiError(error: unknown): error is UpstreamApiError {
  return error instanceof UpstreamApiError;
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown[] = [],
): Response {
  return res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

export function sendValidationError(
  res: Response,
  details: unknown[],
): Response {
  return sendError(res, 400, "BAD_REQUEST", "Validation failed", details);
}

export function sendRouteError(res: Response, error: unknown): Response {
  if (isUpstreamApiError(error)) {
    const status = mapStatusCode(error.status);
    return sendError(
      res,
      status,
      mapErrorCode(status),
      error.message,
      error.details,
    );
  }

  if (axios.isAxiosError(error)) {
    const status = mapStatusCode(error.response?.status ?? 502);
    return sendError(res, status, mapErrorCode(status), upstreamErrorMessages[status], []);
  }

  // Le détail d'une erreur imprévue (PostgreSQL, bug) reste dans les logs.
  console.error("[BFF Project] Erreur inattendue", error);
  return sendError(res, 500, "INTERNAL_SERVER_ERROR", "Erreur interne du serveur.", []);
}

export async function fetchProjects() {
  return (await projectClient.getProjects()).data;
}

export async function fetchProjectsForUser(user: ProjectUserContext) {
  const visibleProjects = await listVisibleProjectRows(user);
  if (visibleProjects) return { projects: visibleProjects };
  return fetchProjects();
}

function disabledOnApi(feature: string): UpstreamApiError {
  return new UpstreamApiError(
    501,
    `${feature} n'est pas disponible via Project_API ; activez PROJECT_DB_ACCESS.`,
  );
}

/**
 * Sans base de données, les routes qui écrivent puis relisent un projet échoueraient après avoir écrit dans
 * Project_API (0.4.1 ne publie plus GET /projects/{project_id}/ et n'a aucune opération de modification de
 * projet) : elles appellent ce garde après les contrôles de droits et répondent 501 avant toute écriture.
 */
export function requireDatabaseAccess(feature: string): void {
  if (!isProjectDatabaseAccessEnabled()) throw disabledOnApi(feature);
}

export async function fetchProjectUsers(projectId: number): Promise<User[]> {
  const result = (await projectClient.getProjectUsers(projectId)).data;

  return result.users;
}

export async function fetchProjectUsersOrEmpty(
  projectId: number,
): Promise<User[]> {
  try {
    return await fetchProjectUsers(projectId);
  } catch {
    return [];
  }
}

export async function fetchProjectTasks(
  projectId: number,
): Promise<TaskView[]> {
  const result = (await projectClient.getProjectTasks(projectId)).data;

  return result.tasks;
}

export async function fetchProjectBundle(projectId: number): Promise<{
  project: ProjetView;
  tasks: TaskView[];
  users: User[];
}> {
  if (isProjectDatabaseAccessEnabled()) {
    const databaseBundle = await getProjectBundleFromDatabase(projectId);
    if (!databaseBundle) throw new UpstreamApiError(404, 'Projet introuvable.');
    return databaseBundle;
  }

  // GET /api/v1/projects/{project_id}/ est désactivé dans Project_API 0.4.1.
  throw disabledOnApi("La lecture d'un projet");
}

export async function createProjectOnApi(
  body: CreateProjectView,
): Promise<CreateProjectResultView> {
  const result = (await projectClient.createProject(body)).data;

  if (!result || !Number.isInteger(result.project_id) || result.project_id <= 0) {
    throw new UpstreamApiError(502, 'Project_API a retourné une réponse invalide lors de la création du projet.');
  }

  return result;
}

export async function syncProjectUsersOnApi(projectId: number, userIds: string[]): Promise<void> {
  const desiredUserIds = new Set(
    userIds
      .map((userId) => parsePublicId(userId))
      .filter((userId): userId is number => userId !== null),
  );

  if (desiredUserIds.size === 0) return;

  if (isProjectDatabaseAccessEnabled()) {
    await syncProjectMembers(projectId, Array.from(desiredUserIds));
    return;
  }

  const currentUsers = await fetchProjectUsersOrEmpty(projectId);
  const currentUserIds = new Set(currentUsers.map((user) => user.id));

  await Promise.all([
    ...Array.from(desiredUserIds)
      .filter((userId) => !currentUserIds.has(userId))
      .map((userId) => projectClient.addUserToProject(projectId, { user_id: userId })),
    ...currentUsers
      .filter((user) => !desiredUserIds.has(user.id))
      .map((user) =>
        projectApiAxios.delete(`/api/v1/projects/${projectId}/users/${user.id}/`),
      ),
  ]);
}

export async function createTaskOnApi(
  projectId: number,
  body: CreateTaskView,
): Promise<CreateTaskResultView> {
  if (isProjectDatabaseAccessEnabled()) {
    return {
      task_id: await createTaskRecord(projectId, {
        title: body.name,
        status: body.status,
        priority: body.priority,
        dueDate: body.due_date,
        assignedTo: body.assigned_to,
        fields: body.fields,
      }),
      name: body.name,
      description: body.description,
    };
  }

  const result = (await projectClient.createTask(projectId, body)).data;
  if (!result || !Number.isInteger(result.task_id) || result.task_id <= 0) {
    throw new UpstreamApiError(502, 'Project_API a retourné une réponse invalide lors de la création de la tâche.');
  }
  return result;
}

export async function deleteProjectOnApi(projectId: number): Promise<void> {
  if (isProjectDatabaseAccessEnabled()) {
    await deleteProjectRecord(projectId);
    return;
  }
  await projectClient.deleteProject(projectId);
}

export async function patchTaskOnApi(
  projectId: number,
  taskId: number,
  body: PatchTaskView,
): Promise<void> {
  if (isProjectDatabaseAccessEnabled()) {
    await updateTaskRecord(projectId, taskId, {
      title: body.name,
      status: body.status,
      priority: body.priority,
      dueDate: body.due_date,
      assignedTo: body.assigned_to,
    });
    return;
  }
  // PATCH /api/v1/projects/{project_id}/tasks/{task_id}/ est désactivé dans Project_API 0.4.1.
  throw disabledOnApi("La modification d'une tâche");
}

export async function deleteTaskOnApi(
  projectId: number,
  taskId: number,
): Promise<void> {
  if (isProjectDatabaseAccessEnabled()) {
    await deleteTaskRecord(projectId, taskId);
    return;
  }
  await projectClient.deleteTask(projectId, taskId);
}

export function parsePublicId(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d+)$/);

  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isNaN(parsed) ? null : parsed;
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

export function deriveBackendProjectStatus(
  tasks: TaskView[],
): ProjetView["status"] {
  if (tasks.length === 0) {
    return "Active";
  }

  const completed = tasks.filter(
    (task) => mapTaskStatus(task.status) === "done",
  ).length;

  if (completed === tasks.length) {
    return "Completed";
  }

  if (completed > 0) {
    return "Active";
  }

  return "Active";
}

export function deriveProjectDueDate(tasks: TaskView[]): string {
  if (tasks.length === 0) {
    return nowIso();
  }

  const sorted = [...tasks].sort((left, right) =>
    left.due_date.localeCompare(right.due_date),
  );
  return sorted[0]?.due_date ?? nowIso();
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
    dueDate: task.due_date,
    completed: status === "done",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    permissions,
  };
}

export function mapTaskInputToBackend(task: TaskInputLike): CreateTaskView {
  const assignedTo = task.responsibleId
    ? parsePublicId(task.responsibleId)
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
  if (typeof task.responsibleId === "string") body.assigned_to = parsePublicId(task.responsibleId);
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

export function buildProjectResponseFromState(options: {
  project: ProjetView;
  tasks: TaskView[];
  users: User[];
  permissions?: ProjectPermissions;
  override?: Partial<BffProjectListItem>;
}): BffProjectListItem {
  return {
    ...mapProjectToDto(options.project, options.tasks, options.users, options.permissions),
    ...options.override,
  };
}

export function buildTaskResponseFromState(options: {
  task: TaskView;
  users: User[];
  permissions?: TaskPermissions;
  override?: Partial<BffProjectTask>;
}): BffProjectTask {
  return {
    ...mapTaskToDto(options.task, options.users, options.permissions),
    ...options.override,
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

export function buildProjectResponseOverridesFromCreateBody(
  body: BffCreateProjectInput,
): Partial<BffProjectListItem> {
  return {
    title: body.title,
    description: body.description,
    status: body.status,
    statusLabel: mapProjectStatusLabel(body.status),
    priority: body.priority,
    priorityLabel: mapProjectPriorityLabel(body.priority),
    labels: body.labels,
    dueDate: body.dueDate,
    tasks: {
      total: body.taskItems?.length ?? 0,
      completed:
        body.taskItems?.filter((task) => task.status === "done").length ?? 0,
    },
    progress:
      body.taskItems && body.taskItems.length > 0
        ? Math.round(
            (body.taskItems.filter((task) => task.status === "done").length /
              body.taskItems.length) *
              100,
          )
        : 0,
  };
}

export function buildProjectResponseOverridesFromUpdateBody(
  body: BffUpdateProjectInput,
): Partial<BffProjectListItem> {
  const override: Partial<BffProjectListItem> = {};

  if (typeof body.title === "string") {
    override.title = body.title;
  }

  if (typeof body.description === "string") {
    override.description = body.description;
  }

  if (typeof body.status === "string") {
    override.status = body.status;
    override.statusLabel = mapProjectStatusLabel(body.status);
  }

  if (typeof body.priority === "string") {
    override.priority = body.priority;
    override.priorityLabel = mapProjectPriorityLabel(body.priority);
  }

  if (Array.isArray(body.labels)) {
    override.labels = body.labels;
  }

  if (typeof body.dueDate === "string") {
    override.dueDate = body.dueDate;
  }

  if (Array.isArray(body.taskItems)) {
    override.tasks = {
      total: body.taskItems.length,
      completed: body.taskItems.filter((task) => task.status === "done").length,
    };

    override.progress =
      body.taskItems.length === 0
        ? 0
        : Math.round(
            (body.taskItems.filter((task) => task.status === "done").length /
              body.taskItems.length) *
              100,
          );
  }

  return override;
}

export function buildTaskResponseOverridesFromCreateBody(
  body: BffCreateTaskInput,
): Partial<BffProjectTask> {
  return {
    title: body.title,
    status: body.status,
    statusLabel: mapTaskStatusLabel(body.status),
    priority: body.priority,
    priorityLabel: mapTaskPriorityLabel(body.priority),
    labels: body.labels,
    dueDate: body.dueDate,
    completed: body.status === "done",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function buildTaskResponseOverridesFromUpdateBody(
  body: BffUpdateTaskInput,
): Partial<BffProjectTask> {
  const override: Partial<BffProjectTask> = {};

  if (typeof body.title === "string") {
    override.title = body.title;
  }

  if (typeof body.status === "string") {
    override.status = body.status;
    override.statusLabel = mapTaskStatusLabel(body.status);
    override.completed = body.status === "done";
  }

  if (typeof body.priority === "string") {
    override.priority = body.priority;
    override.priorityLabel = mapTaskPriorityLabel(body.priority);
  }

  if (Array.isArray(body.labels)) {
    override.labels = body.labels;
  }

  if (typeof body.dueDate === "string") {
    override.dueDate = body.dueDate;
  }

  override.updatedAt = nowIso();
  return override;
}

export function handleUnknownError(res: Response, error: unknown): Response {
  return sendRouteError(res, error);
}

export async function buildProjectDtoForUser(
  user: ProjectUserContext,
  project: ProjetView,
  tasks: TaskView[],
  users: User[],
): Promise<BffProjectListItem> {
  return mapProjectToDto(
    project,
    tasks,
    users,
    await getProjectPermissions(user, project.id),
  );
}

export async function buildTaskDtoForUser(
  user: ProjectUserContext,
  projectId: number,
  task: TaskView,
  users: User[],
): Promise<BffProjectTask> {
  return mapTaskToDto(
    task,
    users,
    await getTaskPermissions(user, projectId, task.id, task.assigned_to),
  );
}
