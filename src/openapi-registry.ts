import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ErrorResponseSchema, textField } from '@mairie360/bffs-lib';
import { z } from 'zod';
import { isDueDate } from './routes/Project/due_date';

// Adds the .openapi() methods to Zod
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

export const ProjectStatus = z.enum(['todo', 'in-progress', 'review', 'on-hold', 'done']).openapi({
  description: 'Status of the project: `on-hold` is a project put on hold (Project API `Suspended`, MAIR-1084). A task is never `review` nor `on-hold`',
  example: 'todo',
});

export const ProjectPriority = z.enum(['high', 'medium', 'low']).openapi({
  description: 'Priority of the project',
  example: 'high',
});

export const ViewMode = z.enum(['kanban', 'grid', 'table']).openapi({
  description: 'View mode of the projects',
  example: 'kanban',
});

// Schema -- Personne assignable

export const Person = z.object({
    id: z.string().openapi({ description: 'Unique id of the person', example: '123e4567-e89b-12d3-a456-426614174000' }),
    name: z.string().openapi({ description: 'Name of the person', example: 'John Doe' }),
    avatarUrl: z.string().url().nullable().openapi({ description: "URL of the person's avatar", example: 'https://example.com/avatar.jpg' }),
}).openapi({
    description: 'A person who can be assigned to a project',
});


// Role of a member in a project (MAIR-1088): a `manager` manages the project like the Responsable, Maire and Admin roles.
const MEMBER_ROLES = ['manager', 'contributor', 'reader'] as const;
export const ProjectMemberRole = z.enum(MEMBER_ROLES).openapi('ProjectMemberRole', {
  description: 'Role of a member in the project: `manager` manages it (like the Responsable, Maire and Admin roles), `contributor` and `reader` have the rights of a member. The owner of the project is always `manager`',
  example: 'contributor',
});

// A member of a project with their role in it.
export const ProjectMemberSummary = Person.extend({
  role: ProjectMemberRole,
}).openapi('ProjectMemberSummary', { description: 'A member of a project and their role in it (MAIR-1088)' });

// A member of a project with their role and their load in it (project detail).
export const ProjectMember = ProjectMemberSummary.extend({
  load: z.object({
    tasksOpen: z.number().int().openapi({ description: 'Active tasks of the project assigned to the member that are not done', example: 3 }),
    tasksTotal: z.number().int().openapi({
      description: 'Active tasks of the project assigned to the member. Archived (done) tasks are not counted: the detail only holds their total',
      example: 3,
    }),
  }).openapi({ description: 'Load of the member in the project, counted on its active tasks' }),
}).openapi('ProjectMember', { description: 'A member of a project, their role and their load in it (MAIR-1088)' });

// A Core API group linked to a project: its current and future members all see the project.
export const ProjectGroup = z.object({
    id: z.string().openapi({ description: 'Id of the group, to send as `groupId`', example: 'group-3' }),
    name: z.string().openapi({ description: 'Name of the group', example: 'Roads' }),
}).openapi({ description: 'A group of agents linked to a project' });

export const ProjectGroups = z.object({
    groups: z.array(ProjectGroup).openapi({
      description: "Groups the caller may link to a project, by name: the caller's groups, every group for the Admin and Maire roles",
    }),
});

// A project left without a group (created before groups were required, or its group was deleted in Core API).
export const ProjectWithoutGroup = z.object({
    id: z.string().openapi({ description: 'Id of the project', example: 'project-9' }),
    title: z.string().openapi({ description: 'Title of the project', example: 'LED street lighting' }),
    createdAt: z.string().nullable().openapi({ description: 'Creation date (ISO 8601), `null` when unknown', example: '2026-03-03T09:12:00+00:00' }),
});

export const ProjectsWithoutGroup = z.object({
    projects: z.array(ProjectWithoutGroup).openapi({ description: 'Projects without a group, newest first; empty when every project has one' }),
});

// Schema -- Project for the card / table / kanban views


export const ProjectListItem = z.object({
    id: z.string().openapi({ description: 'Unique id of the project', example: '123e4567-e89b-12d3-a456-426614174000' }),
    title: z.string().openapi({ description: 'Title of the project', example: 'New project' }),
    description: z.string().openapi({ description: 'Description of the project', example: 'Detailed description of the project' }),
    status: ProjectStatus,
    statusLabel: z.string().openapi({ description: 'Label of the project status', example: 'À faire' }),
    priority: ProjectPriority,
    priorityLabel: z.string().openapi({ description: 'Label of the project priority', example: 'Haute' }),
    responsible: Person,
    assignees: z.array(Person).openapi({
      description: 'Members of the project; in the projects page, its first 5 members only (the project detail lists them all)',
    }),
    labels: z.array(z.string()).openapi({ description: 'Labels of the project', example: ['frontend', 'urgent'] }),
    progress: z.number().min(0).max(100).openapi({ description: 'Progress of the project, in percent', example: 75 }),
    dueDate: z.string().openapi({ description: 'Due date of the project, ISO 8601', example: '2024-12-31T23:59:59Z' }),
    createdAt: z.string().openapi({ description: 'Creation date of the project, ISO 8601', example: '2024-01-01T12:00:00Z' }),
    members: z.array(ProjectMemberSummary).openapi({
      description: 'Members of the project and their role (MAIR-1088); in the projects page, its first 5 members only',
    }),
    // Inline: a nullable reference becomes an `allOf` that refuses `null`.
    myRole: z.enum(MEMBER_ROLES).nullable().openapi({
      description: 'Role of the caller in the project (MAIR-1088), `null` when they are not a member. `permissions` already counts it: a `manager` member manages the project',
    }),
    budgetVoted: z.number().int().nullable().openapi({
      description: 'Budget voted by the council, in cents of euro (MAIR-1085: `1250000` is 12 500,00 €), `null` when not filled in',
      example: 1250000,
    }),
    budgetCommitted: z.number().int().nullable().openapi({
      description: 'Budget already committed (orders placed), in cents of euro, `null` when not filled in; it may exceed `budgetVoted`',
      example: 430000,
    }),
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
        canView: z.boolean().openapi({ description: 'Whether the user can see the project', example: true }),
        canEdit: z.boolean().openapi({ description: 'Whether the user can edit the project', example: true }),
        canDuplicate: z.boolean().openapi({ description: 'Whether the user can duplicate the project', example: false }),
        canDelete: z.boolean().openapi({ description: 'Whether the user can delete the project', example: false }),
        canCreateTask: z.boolean().openapi({ description: 'Whether the user can create tasks in the project', example: true }),
        canAssignMembers: z.boolean(),
        canClose: z.boolean(),
    }).openapi({ description: 'Permissions of the user on the project' }),
}).openapi({
    description: 'A project for the card, table or kanban views',
});

// Schema -- Task

export const ProjectTask = z.object({
    id: z.string().openapi({ description: 'Unique id of the task', example: '123e4567-e89b-12d3-a456-426614174000' }),
    title: z.string().openapi({ description: 'Title of the task', example: 'New task' }),
    description: z.string().openapi({
      description: 'Description of the task, line breaks kept; an empty string when it has none',
      example: 'Ask three roofers for a quote',
    }),
    status: ProjectStatus,
    statusLabel: z.string().openapi({ description: 'Label of the task status', example: 'À faire' }),
    responsible: Person,
    assignees: z.array(Person).openapi({ description: 'People assigned to the task' }),
    priority: ProjectPriority,
    priorityLabel: z.string().openapi({ description: 'Label of the task priority', example: 'Moyenne' }),
    labels: z.array(z.string()).openapi({ description: 'Labels of the task', example: ['backend', 'important'] }),
    dueDate: z.string().openapi({ description: 'Due date of the task, ISO 8601', example: '2024-12-31T23:59:59Z' }),
    startDate: z.string().nullable().openapi({ description: 'Start date of the task, ISO 8601, `null` when it has none (MAIR-1087)', example: '2024-12-01T00:00:00Z' }),
    completed: z.boolean().openapi({ description: 'Whether the task is completed', example: false }),
    createdAt: z.string().openapi({ description: 'Creation date of the task, ISO 8601', example: '2024-01-01T12:00:00Z' }),
    updatedAt: z.string().optional().openapi({ description: 'Date of the last update of the task, ISO 8601', example: '2024-01-15T15:30:00Z' }),
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
    description: 'A task of a project',
});

registry.register('ProjectStatus', ProjectStatus);
registry.register('ProjectPriority', ProjectPriority);
registry.register('ViewMode', ViewMode);
registry.register('Person', Person);
registry.register('ProjectGroup', ProjectGroup);
registry.register('ProjectGroups', ProjectGroups);
registry.register('ProjectsWithoutGroup', ProjectsWithoutGroup);
registry.register('ProjectListItem', ProjectListItem);

// A milestone of a project (MAIR-1086).
export const Milestone = z.object({
  id: z.string().openapi({ description: 'Id of the milestone', example: 'milestone-1' }),
  title: z.string().openapi({ description: 'Title of the milestone', example: 'Vote du conseil municipal' }),
  dueDate: z.string().openapi({ description: 'Day the milestone is due, `YYYY-MM-DD`', example: '2027-03-15' }),
  reached: z.boolean().openapi({ description: 'Whether the milestone is reached', example: false }),
}).openapi('Milestone', { description: 'A milestone of a project (MAIR-1086)' });

// A project as the detail answers return it: the list item plus its group and milestones (not in `GET /projects-page`).
export const ProjectDetail = ProjectListItem.extend({
  group: ProjectGroup.nullable().openapi({ description: 'Group linked to the project, `null` without one' }),
  members: z.array(ProjectMember).openapi({ description: 'Every member of the project, their role and their load (MAIR-1088)' }),
  milestones: z.array(Milestone).openapi({
    description: 'Its first 100 milestones, by due date then id (`GET /projects/{projectId}/milestones` pages them all)',
  }),
  milestonesTotal: z.number().int().openapi({ description: 'Number of milestones of the project', example: 3 }),
});
registry.register('ProjectDetail', ProjectDetail);
registry.register('ProjectTask', ProjectTask);

// =====================
// PARAMS
// =====================

export const ProjectIdParams = z.object({
  projectId: z.string().openapi({
    description: 'Id of the project',
    example: 'project-1',
  }),
});

export const ProjectTaskParams = z.object({
  projectId: z.string().openapi({
    description: 'Id of the project',
    example: 'project-1',
  }),
  taskId: z.string().openapi({
    description: 'Id of the task',
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

/** Largest page Project API serves, and the highest page number accepted (MAIR-536: both were unbounded). */
export const PROJECTS_PAGE_MAX_LIMIT = 500;
export const PROJECTS_PAGE_MAX_PAGE = 10_000;

export const ProjectsPageQuery = z.object({
  q: z.string().max(255).optional().openapi({ description: 'Case-insensitive text searched in the name and the description', example: 'scan' }),

  status: z
    .enum(['all', 'todo', 'in-progress', 'review', 'on-hold', 'done'])
    .optional()
    .openapi({ description: 'Status filter; `on-hold` keeps the projects put on hold (MAIR-1084)' }),

  priority: z
    .enum(['all', 'high', 'medium', 'low'])
    .optional(),

  dueBefore: DateFilter.optional().openapi({ example: '2030-12-31' }),

  dueAfter: DateFilter.optional().openapi({ example: '2020-01-01' }),

  view: ViewMode.optional(),

  page: z.coerce.number().int().min(1).max(PROJECTS_PAGE_MAX_PAGE).optional().openapi({ example: 1 }),

  limit: z.coerce.number().int().min(1).max(PROJECTS_PAGE_MAX_LIMIT).optional().openapi({ example: 20 }),
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
// `on-hold` is a project status only (MAIR-1084).
// The published enum is the task categories only, so the clients cannot pick `review` or `on-hold`; the runtime schema
// still parses them to answer the field-level message below instead of a bare enum error.
const TaskStatus = ProjectStatus.refine((status) => status !== 'review' && status !== 'on-hold', {
  message: 'review and on-hold are not available for tasks: use todo, in-progress or done, or a statusId of the project',
}).openapi({
  enum: ['todo', 'in-progress', 'done'],
  description: 'Category of the task status: `todo`, `in-progress` or `done` (`review` and `on-hold` are project statuses, refused with a 400)',
  example: 'todo',
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
// A Core API group (`group-<id>`, from `GET /project-groups`).
// The id is a safe integer: at most 15 digits.
const GroupIdField = z.string().regex(/^group-\d{1,15}$/, 'Expected a group-<id> identifier').openapi({
  description: 'Group whose current and future members all see the project (`GET /project-groups`); the id has 1 to 15 digits',
  example: 'group-3',
});
// A date picker sends a date alone (`2030-12-31`): accepted with an ISO 8601 date-time, or empty for "no due date".
// The BFF turns it into the date-time Project API stores (MAIR-559).
const DueDate = z.string().refine(isDueDate, 'Expected a date (YYYY-MM-DD) or an ISO 8601 date-time').openapi({
  description: 'Due date: a date (`YYYY-MM-DD`, read as midnight UTC), an ISO 8601 date-time, or an empty string for none',
  example: '2030-12-31',
});

// Start date of a task (MAIR-1087): same formats as the due date; empty or `null` for none. At or before the due date.
const StartDate = z.string().refine(isDueDate, 'Expected a date (YYYY-MM-DD) or an ISO 8601 date-time').nullable().optional().openapi({
  description: 'Start date (MAIR-1087): a date (`YYYY-MM-DD`, read as midnight UTC) or an ISO 8601 date-time, at or before the due date (400 otherwise). On creation, absent, empty or `null` means none; on update, absent keeps it, `null` or an empty string clears it',
  example: '2030-11-02',
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

  // Required: every project has a group (`GET /project-groups`).
  groupId: GroupIdField,
});

registry.register('CreateProjectBody', CreateProjectBody);

// =====================
// UPDATE PROJECT
// =====================

// The template only applies at creation (its statuses are copied then): not part of a PATCH.
// The group can be changed but not removed: `groupId: null` is refused in 400.
// An amount in cents of euro (MAIR-1085): an integer from 0, `null` clears it.
const BudgetAmount = (example: number, what: string) => z.number().int().min(0).nullable().optional().openapi({
  description: `${what}, in cents of euro: absent keeps it, \`null\` clears it, an integer from 0 replaces it (a negative amount is a 400)`,
  example,
});

export const UpdateProjectBody = CreateProjectBody.omit({ templateId: true, groupId: true }).partial().extend({
  budgetVoted: BudgetAmount(1250000, 'Budget voted by the council'),
  budgetCommitted: BudgetAmount(430000, 'Budget already committed'),
  groupId: GroupIdField.optional().openapi({
    description: 'New group of the project (`GET /project-groups`). Omitted, the group is not changed (a project created before groups were required may still have none); `null` is invalid',
    example: 'group-3',
  }),
});

registry.register('UpdateProjectBody', UpdateProjectBody);

// =====================
// CREATE TASK
// =====================

export const CreateTaskBody = z.object({
  title: Title('Scan task'),

  // Optional, up to 5000 characters. On an update, absent keeps it and an empty string clears it.
  description: Description('Task created by the ZAP scan').optional(),

  status: TaskStatus,

  priority: ProjectPriority,

  responsibleId: PersonId,

  assigneeIds: PersonIds,

  labels: Labels,

  dueDate: DueDate,

  startDate: StartDate,

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

// `on-hold` puts the project on hold (Project API `Suspended`), `review` in review (`Review`), `done` closes it
// (MAIR-1084: `review` used to suspend the project and read back as `review`).
export const CloseProjectBody = z.object({
  status: z.enum(['done', 'review', 'on-hold']).default('done').openapi({
    description: '`done` closes the project, `on-hold` puts it on hold, `review` puts it in review',
  }),
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
  project: ProjectDetail,

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
  statusId: z.string().openapi({ description: 'Id of the status', example: 'status-1' }),
});

export const DeletedProjectStatusParams = ProjectStatusParams.extend({
  // Not seeded by init-test.sql: a scan replaying the example gets a 404 and deletes nothing.
  statusId: ProjectStatusParams.shape.statusId.openapi({ example: 'status-999999' }),
});

// PATCH /projects/{projectId}/statuses/{statusId} gets its own example project (seeded by init-test.sql, MAIR-566):
// its 200 lists every status of the project with its task count, so in project-1, whose tasks the scan creates,
// deletes and moves meanwhile, two probes got different bodies depending on timing and ZAP read the difference as
// an injection. status-11 is the `in-progress` status of project-4, already in the example category.
export const UpdatedProjectStatusParams = ProjectStatusParams.extend({
  projectId: ProjectIdParams.shape.projectId.openapi({ example: 'project-4' }),
  statusId: ProjectStatusParams.shape.statusId.openapi({ example: 'status-11' }),
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
  canManage: z.boolean().openapi({ description: 'Whether the caller may modify this template: an Admin any template (the default one included), a Responsable only the ones they created, never the default one. Deleting it also needs isDefault to be false: the default template cannot be deleted by anyone', example: true }),
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
  templateId: z.string().openapi({ description: 'Id of the template', example: 'template-1' }),
});

export const DeletedProjectTemplateParams = ProjectTemplateParams.extend({
  // Not seeded: a scan replaying the example gets a 404 and deletes nothing.
  templateId: ProjectTemplateParams.shape.templateId.openapi({ example: 'template-999999' }),
});

// =====================
// MEMBERS (MAIR-1088)
// =====================

const MemberUserId = z.string().regex(/^user-\d{1,15}$/, 'Expected a user-<id> identifier').openapi({ example: 'user-3' });

export const ProjectMemberParams = z.object({
  projectId: ProjectIdParams.shape.projectId,
  userId: MemberUserId.openapi({ description: 'Id of the member', example: 'user-3' }),
});

export const DeletedProjectMemberParams = ProjectMemberParams.extend({
  // Not a member of the seeded projects: a scan replaying the example removes nobody.
  userId: ProjectMemberParams.shape.userId.openapi({ example: 'user-999999' }),
});

export const AddProjectMemberBody = z.object({
  userId: MemberUserId.openapi({ description: 'Agent to add (`user-<id>`, one the caller may assign)', example: 'user-3' }),
  role: ProjectMemberRole.optional().openapi({ description: 'Role in the project; absent: `contributor`' }),
}).strict();
registry.register('AddProjectMemberBody', AddProjectMemberBody);

export const UpdateProjectMemberBody = z.object({
  role: ProjectMemberRole,
}).strict();
registry.register('UpdateProjectMemberBody', UpdateProjectMemberBody);

export const ProjectMembers = z.object({
  members: z.array(ProjectMember).openapi({ description: 'Every member of the project, as re-read from Project API' }),
}).openapi('ProjectMembers');

// =====================
// ACTIVITY, PROJECT COMMENTS AND BULK DELETION (MAIR-1089)
// =====================

export const ActivityKind = z.enum(['comment', 'task_created', 'task_updated', 'status_changed']).openapi('ActivityKind', {
  description: 'A comment on the project, or an entry of the history of one of its tasks',
  example: 'comment',
});

export const ActivityItem = z.object({
  kind: ActivityKind,
  id: z.string().openapi({
    description: '`comment-<n>` for a comment, `history-<n>` for a history entry (two id spaces)',
    example: 'comment-12',
  }),
  taskId: z.string().nullable().openapi({ description: 'Task the history entry is about, `null` for a comment', example: 'task-4' }),
  taskTitle: z.string().nullable().openapi({ description: 'Current title of that task, `null` for a comment', example: 'Commander le mobilier' }),
  author: z.object({
    id: z.string().openapi({ example: 'user-2' }),
    name: z.string().openapi({ example: 'Alice Martin' }),
  }).nullable().openapi({ description: 'Author of the entry, `null` for a write of the platform itself or an author who no longer exists' }),
  message: z.string().nullable().openapi({ description: 'Text of a comment, `null` for a history entry', example: 'Devis reçu.' }),
  changes: z.record(z.string(), z.unknown()).nullable().openapi({
    description: 'Changed fields of a history entry, `{ "<field>": { "from", "to" } }`; `null` for a comment and a task creation',
  }),
  label: z.string().openapi({ description: 'Human-readable label (`Comment` for a comment)', example: 'Status changed: À faire → En cours' }),
  createdAt: z.string().openapi({ description: 'Date of the entry, ISO 8601', example: '2026-11-20T08:00:00.000Z' }),
}).openapi('ActivityItem', { description: 'An entry of the activity of a project (MAIR-1089)' });

export const ProjectActivity = z.object({
  items: z.array(ActivityItem).openapi({ description: 'Entries of the page, newest first' }),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number().openapi({ description: 'Number of entries of the project (its comments and the history of all its tasks)' }),
    hasNextPage: z.boolean(),
  }),
}).openapi('ProjectActivity');

/** Page of the activity: `page` from 1, `limit` from 1 to 500 (50 by default). */
export const ActivityQuery = z.object({
  page: z.coerce.number().int().min(1).max(PROJECTS_PAGE_MAX_PAGE).optional().openapi({ example: 1 }),
  limit: z.coerce.number().int().min(1).max(PROJECTS_PAGE_MAX_LIMIT).optional().openapi({ example: 50 }),
});

export const ProjectCommentBody = z.object({
  // Trimmed first, then checked: the published schema is the raw string, so it carries no length limit of its own.
  message: z.string().transform((value) => value.trim()).pipe(noMarkup(z.string().min(1).max(2_000))).openapi({
    description: 'Text of the comment. Leading and trailing whitespace is removed first; what remains must hold 1 to 2000 characters (a blank message is a 400) and no `<` or `>`',
    pattern: '^[^<>]*$',
    example: 'Comment posted by the ZAP scan',
  }),
}).strict();
registry.register('ProjectCommentBody', ProjectCommentBody);

const ProjectPublicId = z.string().regex(/^project-\d{1,15}$/, 'Expected a project-<id> identifier').openapi({ example: 'project-999999' });

export const BulkDeleteProjectsBody = z.object({
  projectIds: z.array(ProjectPublicId).min(1).max(100).openapi({
    description: 'Projects to delete, 1 to 100 (`project-<id>`); a repeated id is handled once',
    // Not seeded: a scan replaying the example deletes nothing.
    example: ['project-999999'],
  }),
}).strict();
registry.register('BulkDeleteProjectsBody', BulkDeleteProjectsBody);

export const BulkDeleteProjectsResult = z.object({
  results: z.array(z.object({
    projectId: z.string().openapi({ example: 'project-9' }),
    status: z.enum(['deleted', 'not_found', 'forbidden']).openapi({
      description: '`deleted`; `not_found` for a project unknown or not visible to the caller; `forbidden` for one they see but may not delete',
    }),
  })).openapi({ description: 'One result per project, in the order Project API handled them' }),
}).openapi('BulkDeleteProjectsResult');

// =====================
// MILESTONES (MAIR-1086)
// =====================

export const ProjectMilestoneParams = z.object({
  projectId: ProjectIdParams.shape.projectId,
  milestoneId: z.string().openapi({ description: 'Id of the milestone', example: 'milestone-1' }),
});

export const DeletedProjectMilestoneParams = ProjectMilestoneParams.extend({
  // Not seeded: a scan replaying the example gets a 404 and deletes nothing.
  milestoneId: ProjectMilestoneParams.shape.milestoneId.openapi({ example: 'milestone-999999' }),
});

/** Page of the milestones: `page` from 1, `limit` from 1 to 500 (100 by default). */
export const MilestonesQuery = z.object({
  page: z.coerce.number().int().min(1).max(PROJECTS_PAGE_MAX_PAGE).optional().openapi({ example: 1 }),
  limit: z.coerce.number().int().min(1).max(PROJECTS_PAGE_MAX_LIMIT).optional().openapi({ example: 100 }),
});

// A day alone, a valid calendar date: Project API stores a DATE.
const MilestoneDueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date (YYYY-MM-DD)')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Expected a date (YYYY-MM-DD)')
  .openapi({
    format: 'date',
    description: 'Day the milestone is due, `YYYY-MM-DD`: a valid calendar day (`2027-02-30` is a 400)',
    example: '2027-03-15',
  });

export const CreateMilestoneBody = z.object({
  title: Title('Scan milestone'),
  dueDate: MilestoneDueDate,
  reached: z.boolean().optional().openapi({ description: 'Already reached; absent: `false`', example: false }),
}).strict();
registry.register('CreateMilestoneBody', CreateMilestoneBody);

// Every field is optional and an absent one keeps its value: without `reached` the milestone stays reached or not.
export const UpdateMilestoneBody = CreateMilestoneBody.partial().extend({
  reached: z.boolean().optional().openapi({
    description: '`true` marks the milestone reached, `false` reopens it; absent, the current value is kept',
    example: true,
  }),
}).strict();
registry.register('UpdateMilestoneBody', UpdateMilestoneBody);

export const ProjectMilestones = z.object({
  milestones: z.array(Milestone).openapi({ description: 'Milestones of the page, by due date then id' }),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number().openapi({ description: 'Number of milestones of the project' }),
    hasNextPage: z.boolean(),
  }),
}).openapi('ProjectMilestones');

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
  429: 'Project API or Core API rate limit reached: retry after the Retry-After header (seconds)',
  500: 'Unexpected server error',
  502: 'Project API or Core API is unreachable or failed',
  503: 'Project API or Core API is not configured (PROJECT_API_URL, CORE_API_URL)',
} as const;

export type ApiErrorStatus = keyof typeof apiErrorDescriptions;

export function apiErrorResponses(...statuses: ApiErrorStatus[]) {
  // A route answering 502 calls an upstream, whose 429 bffs-lib >= 2.4.0 relays with its Retry-After (MAIR-562).
  const declared: ApiErrorStatus[] = statuses.includes(502) && !statuses.includes(429) ? [...statuses, 429] : statuses;
  return Object.fromEntries(declared.map((status) => [status, {
    description: apiErrorDescriptions[status],
    content: { 'application/json': { schema: ErrorResponse } },
  }]));
}
