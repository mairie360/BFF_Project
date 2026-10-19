import { HttpError } from "@mairie360/bffs-lib";
import type { z } from "zod";
import type {
  DynamicTaskField,
  ProjectStatusView,
  ProjectTemplateView,
  StatusCategory as ApiStatusCategory,
  TemplateStatusView,
} from "@mairie360/project-api-openapi/model";
import { projectApi } from "../../clients/projectClient";
import type {
  CreateProjectTaskStatusBody,
  CreateProjectTemplateBody,
  ProjectTaskStatus,
  ProjectTemplate,
  StatusCategory,
  UpdateProjectTaskStatusBody,
  UpdateProjectTemplateBody,
} from "../../openapi-registry";
import type { ProjectUserContext } from "../../auth/project-user";
import { projectCall, type Caller } from "../../services/projectData";

// Task statuses of a project and project templates (MAIR-566). Project API owns both: the BFF maps their ids
// (`status-<id>`, `template-<id>`) and categories, and relays its refusals (409 for a name taken, a status still
// holding tasks or the last status of its category).

type BffStatusCategory = z.infer<typeof StatusCategory>;

const categoryToBff: Record<ApiStatusCategory, BffStatusCategory> = {
  Todo: "todo",
  InProgress: "in-progress",
  Completed: "done",
};

const categoryToApi: Record<BffStatusCategory, ApiStatusCategory> = {
  todo: "Todo",
  "in-progress": "InProgress",
  done: "Completed",
};

function parsePrefixed(prefix: "status" | "template", value: string | undefined): number | null {
  const match = value ? new RegExp(`^${prefix}-(\\d+)$`).exec(value) : null;
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** `status-<id>` → id, `null` for anything else. */
export function parseStatusId(value: string | undefined): number | null {
  return parsePrefixed("status", value);
}

/** `template-<id>` → id, `null` for anything else. */
export function parseTemplateId(value: string | undefined): number | null {
  return parsePrefixed("template", value);
}

export function statusPublicId(statusId: number): string {
  return `status-${statusId}`;
}

export function templatePublicId(templateId: number): string {
  return `template-${templateId}`;
}

/** A path id that is not `status-<id>` names no status: 404 before any upstream call. */
export function requireStatusIdParam(value: string): number {
  const statusId = parseStatusId(value);
  if (statusId === null) throw new HttpError(404, "Status not found");
  return statusId;
}

/** A path id that is not `template-<id>` names no template: 404 before any upstream call. */
export function requireTemplateIdParam(value: string): number {
  const templateId = parseTemplateId(value);
  if (templateId === null) throw new HttpError(404, "Template not found");
  return templateId;
}

/** Templates are managed by the Responsable and Admin roles (Project API refuses the others too). */
export function requireTemplateManagement(user: ProjectUserContext): void {
  if (user.role !== "Admin" && user.role !== "Responsable") {
    throw new HttpError(403, "The Responsable or Admin role is required to manage project templates.");
  }
}

export function mapStatusCategory(category: ApiStatusCategory): BffStatusCategory {
  return categoryToBff[category];
}

export function mapProjectTaskStatus(status: ProjectStatusView): z.infer<typeof ProjectTaskStatus> {
  return {
    id: statusPublicId(status.id),
    name: status.name,
    color: status.color,
    category: mapStatusCategory(status.category),
    position: status.position,
    taskCount: status.task_count,
  };
}

function mapTemplateStatus(status: TemplateStatusView) {
  return {
    name: status.name,
    color: status.color,
    category: mapStatusCategory(status.category),
    position: status.position,
  };
}

function mapCustomField(field: DynamicTaskField) {
  return { label: field.label, type: field.task_type };
}

export function mapProjectTemplate(template: ProjectTemplateView): z.infer<typeof ProjectTemplate> {
  return {
    id: templatePublicId(template.id),
    name: template.name,
    description: template.description ?? null,
    isDefault: template.is_default,
    statuses: [...template.statuses].sort((a, b) => a.position - b.position).map(mapTemplateStatus),
    customFields: template.custom_fields.map(mapCustomField),
  };
}

function statusInputToApi(status: { name: string; color?: string; category: BffStatusCategory }) {
  return {
    name: status.name,
    ...(status.color !== undefined ? { color: status.color } : {}),
    category: categoryToApi[status.category],
  };
}

// --- Project API calls ---

export async function listProjectStatuses(caller: Caller, projectId: number): Promise<ProjectStatusView[]> {
  const { data } = await projectCall(caller, (options) => projectApi.getProjectStatuses(projectId, options), true);
  return [...data.statuses].sort((a, b) => a.position - b.position);
}

export async function createProjectStatusOnApi(
  caller: Caller,
  projectId: number,
  body: z.infer<typeof CreateProjectTaskStatusBody>,
): Promise<number> {
  const { data } = await projectCall(caller, (options) => projectApi.createProjectStatus(projectId, {
    ...statusInputToApi(body),
    ...(body.position !== undefined ? { position: body.position } : {}),
  }, options));
  return data.status_id;
}

export async function updateProjectStatusOnApi(
  caller: Caller,
  projectId: number,
  statusId: number,
  body: z.infer<typeof UpdateProjectTaskStatusBody>,
): Promise<void> {
  await projectCall(caller, (options) => projectApi.updateProjectStatus(projectId, statusId, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.color !== undefined ? { color: body.color } : {}),
    ...(body.category !== undefined ? { category: categoryToApi[body.category] } : {}),
    ...(body.position !== undefined ? { position: body.position } : {}),
  }, options));
}

export async function deleteProjectStatusOnApi(
  caller: Caller,
  projectId: number,
  statusId: number,
  moveTo: number | undefined,
): Promise<void> {
  await projectCall(caller, (options) => projectApi.deleteProjectStatus(
    projectId,
    statusId,
    moveTo === undefined ? undefined : { move_to: moveTo },
    options,
  ));
}

export async function listTemplates(caller: Caller): Promise<ProjectTemplateView[]> {
  const { data } = await projectCall(caller, (options) => projectApi.getTemplates(options), true);
  return data.templates;
}

export async function getTemplateFromApi(caller: Caller, templateId: number): Promise<ProjectTemplateView> {
  const { data } = await projectCall(caller, (options) => projectApi.getTemplate(templateId, options), true);
  return data;
}

export async function createTemplateOnApi(
  caller: Caller,
  body: z.infer<typeof CreateProjectTemplateBody>,
): Promise<number> {
  const { data } = await projectCall(caller, (options) => projectApi.createTemplate({
    name: body.name,
    description: body.description ?? null,
    statuses: body.statuses.map(statusInputToApi),
    custom_fields: [],
  }, options));
  return data.template_id;
}

export async function updateTemplateOnApi(
  caller: Caller,
  templateId: number,
  body: z.infer<typeof UpdateProjectTemplateBody>,
): Promise<void> {
  await projectCall(caller, (options) => projectApi.updateTemplate(templateId, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.statuses !== undefined ? { statuses: body.statuses.map(statusInputToApi) } : {}),
  }, options));
}

export async function deleteTemplateOnApi(caller: Caller, templateId: number): Promise<void> {
  await projectCall(caller, (options) => projectApi.deleteTemplate(templateId, options));
}
