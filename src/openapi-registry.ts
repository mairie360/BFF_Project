import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ErrorResponseSchema, textField } from '@mairie360/bffs-lib';
import { z } from 'zod';
import { isDueDate } from './routes/Project/due_date';

// On ajoute les méthodes .openapi() à Zod
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Bearer JWT required by the lib's `requireBearer` on the session-bound routes (src/app.ts) and forwarded
// upstream. The document requires it on every operation (`openapi.ts`); public operations opt out
// with `security: []`. The ZAP OpenAPI coverage gate reads this to tell which operations must be
// reached authenticated.
export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// Schema -- ENUMS

export const ProjectStatus = z.enum(['todo', 'in-progress', 'review', 'done']).openapi({
  description: 'Le statut du projet',
  example: 'todo',
});

export const ProjectPriority = z.enum(['high', 'medium', 'low']).openapi({
  description: 'La priorité du projet',
  example: 'high',
});

export const ViewMode = z.enum(['kanban', 'grid', 'table']).openapi({
  description: 'Le mode de vue pour les projets',
  example: 'kanban',
});

// Schema -- Personne assignable

export const Person = z.object({
    id: z.string().openapi({ description: 'L\'identifiant unique de la personne', example: '123e4567-e89b-12d3-a456-426614174000' }),
    name: z.string().openapi({ description: 'Le nom de la personne', example: 'John Doe' }),
    avatarUrl: z.string().url().nullable().openapi({ description: 'L\'URL de l\'avatar de la personne', example: 'https://example.com/avatar.jpg' }),
}).openapi({
    description: 'Une personne assignable à un projet',
});


// Schema -- Projet pour carte / table / kanban


export const ProjectListItem = z.object({
    id: z.string().openapi({ description: 'L\'identifiant unique du projet', example: '123e4567-e89b-12d3-a456-426614174000' }),
    title: z.string().openapi({ description: 'Le titre du projet', example: 'Nouveau projet' }),
    description: z.string().openapi({ description: 'La description du projet', example: 'Description détaillée du projet' }),
    status: ProjectStatus,
    statusLabel: z.string().openapi({ description: 'Le libellé du statut du projet', example: 'À faire' }),
    priority: ProjectPriority,
    priorityLabel: z.string().openapi({ description: 'Le libellé de la priorité du projet', example: 'Haute' }),
    responsible: Person,
    assignees: z.array(Person).openapi({
      description: 'Members of the project; in the projects page, its first 5 members only (the project detail lists them all)',
    }),
    labels: z.array(z.string()).openapi({ description: 'La liste des étiquettes associées au projet', example: ['frontend', 'urgent'] }),
    progress: z.number().min(0).max(100).openapi({ description: 'Le pourcentage d\'avancement du projet', example: 75 }),
    dueDate: z.string().openapi({ description: 'La date d\'échéance du projet au format ISO 8601', example: '2024-12-31T23:59:59Z' }),
    createdAt: z.string().openapi({ description: 'La date de création du projet au format ISO 8601', example: '2024-01-01T12:00:00Z' }),
    tasks: z.object({
        total: z.number().openapi({ description: 'Number of tasks of the project, the archived (done) ones included', example: 10 }),
        completed: z.number().openapi({ description: 'Number of done tasks of the project, the archived ones included', example: 7 }),
        active: z.number().openapi({
          description: 'Number of active tasks, the ones the project detail lists (MAIR-559)',
          example: 3,
        }),
        archived: z.number().openapi({
          description: 'Number of archived (done) tasks, listed apart by `GET /projects/{projectId}/archived-tasks` (MAIR-559)',
          example: 7,
        }),
    }).openapi({
      description: 'Task counts of the project: `progress` is `completed / total`; `active + archived = total`',
    }),
    permissions: z.object({
        canView: z.boolean().openapi({ description: 'Indique si l\'utilisateur peut voir le projet', example: true }),
        canEdit: z.boolean().openapi({ description: 'Indique si l\'utilisateur peut éditer le projet', example: true }),
        canDuplicate: z.boolean().openapi({ description: 'Indique si l\'utilisateur peut dupliquer le projet', example: false }),
        canDelete: z.boolean().openapi({ description: 'Indique si l\'utilisateur peut supprimer le projet', example: false }),
        canCreateTask: z.boolean().openapi({ description: 'Indique si l\'utilisateur peut créer des tâches dans le projet', example: true }),
        canAssignMembers: z.boolean(),
        canClose: z.boolean(),
    }).openapi({ description: 'Les permissions de l\'utilisateur sur le projet' }),
}).openapi({
    description: 'Un projet pour les vues de type carte, table ou kanban',
});

// Schema -- Tâche

export const ProjectTask = z.object({
    id: z.string().openapi({ description: 'L\'identifiant unique de la tâche', example: '123e4567-e89b-12d3-a456-426614174000' }),
    title: z.string().openapi({ description: 'Le titre de la tâche', example: 'Nouvelle tâche' }),
    status: ProjectStatus,
    statusLabel: z.string().openapi({ description: 'Le libellé du statut de la tâche', example: 'À faire' }),
    responsible: Person,
    assignees: z.array(Person).openapi({ description: 'La liste des personnes assignées à la tâche' }),
    priority: ProjectPriority,
    priorityLabel: z.string().openapi({ description: 'Le libellé de la priorité de la tâche', example: 'Moyenne' }),
    labels: z.array(z.string()).openapi({ description: 'La liste des étiquettes associées à la  tâche', example: ['backend', 'important'] }),
    dueDate: z.string().openapi({ description: 'La date d\'échéance de la tâche au format ISO 8601', example: '2024-12-31T23:59:59Z' }),
    completed: z.boolean().openapi({ description: 'Indique si la tâche est complétée', example: false }),
    createdAt: z.string().openapi({ description: 'La date de création de la tâche au format ISO 8601', example: '2024-01-01T12:00:00Z' }),
    updatedAt: z.string().optional().openapi({ description: 'La date de dernière mise à jour de la tâche au format ISO 8601', example: '2024-01-15T15:30:00Z' }),
    statusId: z.string().optional().openapi({ description: 'The status of the project the task is in (MAIR-566); `status` is its category', example: 'status-1' }),
    statusName: z.string().optional().openapi({ description: 'Name of that status, as the Kanban column shows it', example: 'À valider' }),
    permissions: z.object({
      canView: z.boolean(),
      canEdit: z.boolean(),
      canDelete: z.boolean(),
      canUpdateStatus: z.boolean(),
      canComment: z.boolean(),
    }),
}).openapi({
    description: 'Une tâche associée à un projet',
});

registry.register('ProjectStatus', ProjectStatus);
registry.register('ProjectPriority', ProjectPriority);
registry.register('ViewMode', ViewMode);
registry.register('Person', Person);
registry.register('ProjectListItem', ProjectListItem);
registry.register('ProjectTask', ProjectTask);

// =====================
// PARAMS
// =====================

export const ProjectIdParams = z.object({
  projectId: z.string().openapi({
    description: 'Identifiant du projet',
    example: 'project-1',
  }),
});

export const ProjectTaskParams = z.object({
  projectId: z.string().openapi({
    description: 'Identifiant du projet',
    example: 'project-1',
  }),
  taskId: z.string().openapi({
    description: 'Identifiant de la tâche',
    example: 'task-1',
  }),
});

registry.register('ProjectIdParams', ProjectIdParams);
registry.register('ProjectTaskParams', ProjectTaskParams);

// DELETE routes get their own example ids (seeded by init-test.sql): a scan replaying the examples
// must not delete the project and task that the other routes read or update.
export const DeletedProjectIdParams = ProjectIdParams.extend({
  projectId: ProjectIdParams.shape.projectId.openapi({ example: 'project-2' }),
});

export const DeletedTaskParams = ProjectTaskParams.extend({
  taskId: ProjectTaskParams.shape.taskId.openapi({ example: 'task-2' }),
});

// POST /projects/{projectId}/statuses gets its own example project (seeded by init-test.sql, MAIR-566): the statuses
// a scan creates there would otherwise take names in project-1, whose status-1 the PATCH example renames, and turn
// those renames into name conflicts (409) that depend on what the scan sent before.
export const StatusCreationProjectIdParams = ProjectIdParams.extend({
  projectId: ProjectIdParams.shape.projectId.openapi({ example: 'project-3' }),
});

// =====================
// QUERIES
// =====================

// An unparsable date would filter every project out (NaN comparisons): it is refused instead.
const DateFilter = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a date');

export const ProjectsPageQuery = z.object({
  q: z.string().max(255).optional().openapi({ description: 'Case-insensitive text searched in the name and the description', example: 'scan' }),

  status: z
    .enum(['all', 'todo', 'in-progress', 'review', 'done'])
    .optional(),

  priority: z
    .enum(['all', 'high', 'medium', 'low'])
    .optional(),

  dueBefore: DateFilter.optional().openapi({ example: '2030-12-31' }),

  dueAfter: DateFilter.optional().openapi({ example: '2020-01-01' }),

  view: ViewMode.optional(),

  page: z.coerce.number().optional().openapi({ example: 1 }),

  limit: z.coerce.number().optional().openapi({ example: 20 }),
});

registry.register('ProjectsPageQuery', ProjectsPageQuery);

// =====================
// CREATE PROJECT
// =====================

// People are referenced by their public id (`user-<id>`): another public id (`project-1`, `task-1`) must
// not be read as a user. The examples name users seeded by init-test.sql. An empty responsible means "nobody".
const PersonId = z.string().regex(/^(?:user-\d+)?$/, 'Expected a user-<id> identifier').openapi({ example: 'user-1' });
const PersonIds = z.array(
  z.string().regex(/^user-\d+$/, 'Expected a user-<id> identifier').openapi({ example: 'user-1' }),
);
// Stored texts are rendered by the fronts: `<` and `>` are refused. Titles, labels and descriptions follow Project
// API's rules (MAIR-560: 1 to 255 characters, not blank, no control character; a description up to 5000 characters,
// line breaks and tabs allowed), so a bad value is a 400 naming the field instead of the API's bare one.
const noMarkup = (schema: z.ZodString) => schema.regex(/^[^<>]*$/, 'Must not contain < or >');
const Title = (example: string) => textField({ max: 255, min: 1, noMarkup: true }).openapi({ example });
const Description = (example: string) => textField({ max: 5_000, multiline: true, noMarkup: true }).openapi({ example });
const Labels = z.array(textField({ max: 255, min: 1, noMarkup: true }).openapi({ example: 'security' }));
// A task's `status` is the category of its status (MAIR-566): `todo`, `in-progress` or `done`. `review` is refused with
// a clear detail instead of Project API's bare 400; a review step is a status of the project (`statusId`), e.g. the
// "À valider" status of the "Avec validation" template, in the `in-progress` category.
const TaskStatus = ProjectStatus.refine((status) => status !== 'review', {
  message: 'review is not available for tasks: use todo, in-progress or done, or a statusId of the project',
});
// A status of the task's project (`status-<id>`, from `GET /projects/{projectId}/statuses`, MAIR-566).
const StatusIdField = z.string().regex(/^status-\d+$/, 'Expected a status-<id> identifier').openapi({
  description: 'A status of the project (`GET /projects/{projectId}/statuses`): the task takes its category',
  example: 'status-1',
});
// A project template (`template-<id>`, from `GET /project-templates`, MAIR-566).
const TemplateIdField = z.string().regex(/^template-\d+$/, 'Expected a template-<id> identifier').openapi({
  description: 'Template the project is created from (`GET /project-templates`): its statuses are copied into the project. Absent: the default template',
  example: 'template-1',
});
// A date picker sends a date alone (`2030-12-31`): accepted with an ISO 8601 date-time, or empty for "no due date".
// The BFF turns it into the date-time Project API stores (MAIR-559).
const DueDate = z.string().refine(isDueDate, 'Expected a date (YYYY-MM-DD) or an ISO 8601 date-time').openapi({
  description: 'Due date: a date (`YYYY-MM-DD`, read as midnight UTC), an ISO 8601 date-time, or an empty string for none',
  example: '2030-12-31',
});

export const CreateProjectTaskInput = z.object({
  title: Title('Scan task'),

  status: TaskStatus,

  priority: ProjectPriority,

  assigneeIds: PersonIds,

  labels: Labels,

  dueDate: DueDate,
});

export const CreateProjectBody = z.object({
  title: Title('Scan project'),

  description: Description('Project created by the ZAP scan'),

  status: ProjectStatus,

  priority: ProjectPriority,

  responsibleId: PersonId,

  assigneeIds: PersonIds,

  labels: Labels,

  dueDate: DueDate,

  taskItems: z.array(CreateProjectTaskInput).optional(),

  templateId: TemplateIdField.optional(),
});

registry.register('CreateProjectBody', CreateProjectBody);

// =====================
// UPDATE PROJECT
// =====================

// The template only applies at creation (its statuses are copied then): not part of a PATCH.
export const UpdateProjectBody = CreateProjectBody.omit({ templateId: true }).partial();

registry.register('UpdateProjectBody', UpdateProjectBody);

// =====================
// CREATE TASK
// =====================

export const CreateTaskBody = z.object({
  title: Title('Scan task'),

  status: TaskStatus,

  priority: ProjectPriority,

  responsibleId: PersonId,

  assigneeIds: PersonIds,

  labels: Labels,

  dueDate: DueDate,

  statusId: StatusIdField.optional(),
});

registry.register('CreateTaskBody', CreateTaskBody);

// =====================
// UPDATE TASK
// =====================

export const UpdateTaskBody = CreateTaskBody.partial();

registry.register('UpdateTaskBody', UpdateTaskBody);

// =====================
// UPDATE TASK STATUS
// =====================

// Either a category (`status`: the first status of it in the project) or a status of the project (`statusId`, MAIR-566,
// which wins when both are sent).
export const UpdateTaskStatusBody = z.object({
  status: TaskStatus.optional(),
  statusId: StatusIdField.optional(),
}).refine((body) => body.status !== undefined || body.statusId !== undefined, {
  message: 'Give status or statusId',
});

registry.register(
  'UpdateTaskStatusBody',
  UpdateTaskStatusBody,
);

export const CloseProjectBody = z.object({
  status: z.enum(['done', 'review']).default('done'),
});

export const TaskCommentBody = z.object({
  message: noMarkup(z.string().trim().min(1).max(2_000)).openapi({ example: 'Comment posted by the ZAP scan' }),
});

export const TaskComment = z.object({
  id: z.string(),
  message: z.string(),
  author: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.string(),
});

export const TaskHistoryEntry = z.object({
  id: z.string(),
  action: z.string(),
  label: z.string(),
  author: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.string(),
  changes: z.record(z.string(), z.unknown()).optional(),
});

export const TaskCollaborationResponse = z.object({
  comments: z.array(TaskComment).openapi({
    description: 'The most recent comments of the page, in reading order (oldest first)',
  }),
  history: z.array(TaskHistoryEntry).openapi({ description: 'The most recent history entries of the page, newest first' }),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    commentsTotal: z.number().openapi({ description: 'Number of comments of the task' }),
    historyTotal: z.number().openapi({ description: 'Number of history entries of the task' }),
    hasNextPage: z.boolean().openapi({ description: 'Older comments or history entries remain' }),
  }),
});

/** Page of the follow-up of a task: `page` from 1, `limit` from 1 to 100 (50 by default). */
export const TaskCollaborationQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional().openapi({ example: 1 }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ example: 50 }),
});

registry.register('CloseProjectBody', CloseProjectBody);
registry.register('TaskCommentBody', TaskCommentBody);
registry.register('TaskComment', TaskComment);
registry.register('TaskHistoryEntry', TaskHistoryEntry);
registry.register('TaskCollaborationResponse', TaskCollaborationResponse);

// =====================
// PROJECT DETAILS RESPONSE
// =====================

export const ProjectDetailsResponse = z.object({
  project: ProjectListItem,

  taskItems: z.array(ProjectTask),
});

registry.register(
  'ProjectDetailsResponse',
  ProjectDetailsResponse,
);

// =====================
// PROJECTS PAGE RESPONSE
// =====================

export const ProjectsPageResponse = z.object({
  access: z.object({
    role: z.enum(['Admin', 'Maire', 'Responsable', 'User', 'Guest']),
    scope: z.enum(['all', 'team', 'assigned']),
    canCreateProject: z.boolean(),
    canManageProjects: z.boolean(),
    canManageTasks: z.boolean(),
    canUpdateAssignedTaskStatus: z.boolean(),
    canCommentTasks: z.boolean(),
  }),
  page: z.object({
    title: z.string(),
    subtitle: z.string(),
    defaultView: ViewMode,

    views: z.array(
      z.object({
        value: ViewMode,
        label: z.string(),
      }),
    ),
  }),

  filters: z.object({
    search: z.string().nullable(),

    status: z.string(),

    priority: z.string(),

    statuses: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    ),

    priorities: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    ),
  }),

  options: z.object({
    members: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        name: z.string(),
        avatarUrl: z.string().nullable(),
      }),
    ),

    labels: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    ),
  }),

  summary: z.object({
    totalProjects: z.number(),

    projectsByStatus: z.record(z.string(), z.number()),

    projectsByPriority: z.record(z.string(), z.number()),
  }),

  kanban: z.object({
    columns: z.array(
      z.object({
        status: ProjectStatus,
        label: z.string(),
        projectIds: z.array(z.string()).openapi({
          description: 'Ids of the projects of the current page in this column (the only ones the response holds)',
        }),
        count: z.number().openapi({ description: 'Number of matching projects in this column, every page included' }),
      }),
    ),
  }),

  projects: z.array(ProjectListItem),

  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    hasNextPage: z.boolean(),
  }),
});

registry.register(
  'ProjectsPageResponse',
  ProjectsPageResponse,
);

// =====================
// TASK STATUSES AND PROJECT TEMPLATES (MAIR-566)
// =====================

// The three fixed categories a status belongs to: they drive the archiving (`done`), the progress and the pending tasks.
export const StatusCategory = z.enum(['todo', 'in-progress', 'done']).openapi({
  description: 'Category of a status: `todo`, `in-progress` or `done` (a `done` task is archived)',
  example: 'in-progress',
});
const StatusName = (example: string) => textField({ max: 100, min: 1, noMarkup: true }).openapi({ example });
const StatusColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected # followed by 6 hexadecimal digits').openapi({ example: '#D97706' });
const StatusPosition = z.number().int().min(0).openapi({ description: 'Position among the statuses, from 0', example: 2 });

export const ProjectTaskStatus = z.object({
  id: z.string().openapi({ example: 'status-1' }),
  name: z.string().openapi({ example: 'À valider' }),
  color: z.string().openapi({ example: '#D97706' }),
  category: StatusCategory,
  position: z.number().int().openapi({ example: 2 }),
  taskCount: z.number().int().openapi({ description: 'Tasks in this status, archived ones included', example: 3 }),
}).openapi('ProjectTaskStatus', { description: 'A task status of a project: a Kanban column' });

export const ProjectTaskStatuses = z.object({
  statuses: z.array(ProjectTaskStatus).openapi({ description: 'Statuses of the project, by position' }),
}).openapi('ProjectTaskStatuses');

export const CreateProjectTaskStatusBody = z.object({
  name: StatusName('Scan status'),
  color: StatusColor.optional(),
  category: StatusCategory,
  position: StatusPosition.optional(),
}).strict();
registry.register('CreateProjectTaskStatusBody', CreateProjectTaskStatusBody);

export const UpdateProjectTaskStatusBody = z.object({
  name: StatusName('Scan status renamed').optional(),
  color: StatusColor.optional(),
  category: StatusCategory.optional(),
  position: StatusPosition.optional(),
}).strict();
registry.register('UpdateProjectTaskStatusBody', UpdateProjectTaskStatusBody);

export const ProjectStatusParams = z.object({
  projectId: ProjectIdParams.shape.projectId,
  statusId: z.string().openapi({ description: 'Identifiant du statut', example: 'status-1' }),
});

export const DeletedProjectStatusParams = ProjectStatusParams.extend({
  // Not seeded by init-test.sql: a scan replaying the example gets a 404 and deletes nothing.
  statusId: ProjectStatusParams.shape.statusId.openapi({ example: 'status-999999' }),
});

export const DeleteProjectStatusQuery = z.object({
  moveTo: StatusIdField.optional().openapi({
    description: 'Status to move the tasks of the deleted one to; required when it holds tasks (409 otherwise)',
    example: 'status-2',
  }),
});

const TemplateStatus = z.object({
  name: z.string().openapi({ example: 'À valider' }),
  color: z.string().openapi({ example: '#D97706' }),
  category: StatusCategory,
  position: z.number().int().openapi({ example: 2 }),
});

const TemplateCustomField = z.object({
  label: z.string().openapi({ example: 'Budget' }),
  type: z.string().openapi({ description: 'Field type, as Project API names it', example: 'Number' }),
});

export const ProjectTemplate = z.object({
  id: z.string().openapi({ example: 'template-1' }),
  name: z.string().openapi({ example: 'Avec validation' }),
  description: z.string().nullable().openapi({ example: 'Tâches relues avant validation' }),
  isDefault: z.boolean().openapi({ description: 'Template of a project created without templateId; cannot be deleted', example: false }),
  statuses: z.array(TemplateStatus).openapi({ description: 'Statuses copied into a project created from it, by position' }),
  customFields: z.array(TemplateCustomField).openapi({ description: 'Custom task fields copied into the project' }),
}).openapi('ProjectTemplate', { description: 'A project template (MAIR-566)' });

export const ProjectTemplates = z.object({
  templates: z.array(ProjectTemplate),
}).openapi('ProjectTemplates');

const TemplateStatusInput = z.object({
  name: StatusName('Scan status'),
  color: StatusColor.optional(),
  category: StatusCategory,
}).strict();

export const CreateProjectTemplateBody = z.object({
  name: textField({ max: 100, min: 1, noMarkup: true }).openapi({ example: 'Scan template' }),
  description: textField({ max: 1_000, multiline: true, noMarkup: true }).optional().openapi({ example: 'Template created by the ZAP scan' }),
  statuses: z.array(TemplateStatusInput).min(1).max(30).openapi({
    description: 'Statuses in order; at least one per category (todo, in-progress, done)',
  }),
}).strict();
registry.register('CreateProjectTemplateBody', CreateProjectTemplateBody);

export const UpdateProjectTemplateBody = CreateProjectTemplateBody.partial().strict();
registry.register('UpdateProjectTemplateBody', UpdateProjectTemplateBody);

export const ProjectTemplateParams = z.object({
  templateId: z.string().openapi({ description: 'Identifiant du modèle', example: 'template-1' }),
});

export const DeletedProjectTemplateParams = ProjectTemplateParams.extend({
  // Not seeded: a scan replaying the example gets a 404 and deletes nothing.
  templateId: ProjectTemplateParams.shape.templateId.openapi({ example: 'template-999999' }),
});

// =====================
// ERROR
// =====================

// Body of every error answer, shared by every BFF (`@mairie360/bffs-lib`): `{ error: { code, message, details } }`.
// clone(): the lib builds its schemas on import, before extendZodWithOpenApi() above, and zod 4 only
// adds .openapi() to schemas created after the extension.
export const ErrorResponse = registry.register('ErrorResponse', ErrorResponseSchema.clone());

// Error statuses answered with ErrorResponse. The /projects* routes require a verified Bearer token (401), read the
// caller's roles from it or from Core API (401, 502), and answer 503 when an upstream URL is not configured. Each route passes the
// same list to `callerOf(req, ERROR_STATUSES)` (services/projectData.ts): an upstream 4xx is only relayed when
// the route declares it, any other upstream status becomes 502 (`callUpstream` of @mairie360/bffs-lib).
const apiErrorDescriptions = {
  400: 'Invalid request',
  401: 'Missing, invalid or expired session',
  403: 'Insufficient rights',
  404: 'Project or task not found or not visible',
  409: 'Conflicts with the current state (a name already taken, a status still holding tasks, the last status of its category)',
  500: 'Unexpected server error',
  502: 'Project API or Core API is unreachable or failed',
  503: 'Project API or Core API is not configured (PROJECT_API_URL, CORE_API_URL)',
} as const;

export type ApiErrorStatus = keyof typeof apiErrorDescriptions;

export function apiErrorResponses(...statuses: ApiErrorStatus[]) {
  return Object.fromEntries(statuses.map((status) => [status, {
    description: apiErrorDescriptions[status],
    content: { 'application/json': { schema: ErrorResponse } },
  }]));
}
