import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// On ajoute les méthodes .openapi() à Zod
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

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
    assignees: z.array(Person).openapi({ description: 'La liste des personnes assignées au projet' }),
    labels: z.array(z.string()).openapi({ description: 'La liste des étiquettes associées au projet', example: ['frontend', 'urgent'] }),
    progress: z.number().min(0).max(100).openapi({ description: 'Le pourcentage d\'avancement du projet', example: 75 }),
    dueDate: z.string().openapi({ description: 'La date d\'échéance du projet au format ISO 8601', example: '2024-12-31T23:59:59Z' }),
    createdAt: z.string().openapi({ description: 'La date de création du projet au format ISO 8601', example: '2024-01-01T12:00:00Z' }),
    tasks: z.object({
        total: z.number().openapi({ description: 'Le nombre total de tâches dans le projet', example: 10 }),
        completed: z.number().openapi({ description: 'Le nombre de tâches complétées dans le projet', example: 7 }),
    }).openapi({ description: 'Les statistiques des tâches du projet' }),
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

// =====================
// QUERIES
// =====================

export const ProjectsPageQuery = z.object({
  q: z.string().optional(),

  status: z
    .enum(['all', 'todo', 'in-progress', 'review', 'done'])
    .optional(),

  priority: z
    .enum(['all', 'high', 'medium', 'low'])
    .optional(),

  dueBefore: z.string().optional(),

  dueAfter: z.string().optional(),

  view: ViewMode.optional(),

  page: z.coerce.number().optional(),

  limit: z.coerce.number().optional(),
});

registry.register('ProjectsPageQuery', ProjectsPageQuery);

// =====================
// CREATE PROJECT
// =====================

export const CreateProjectTaskInput = z.object({
  title: z.string(),

  status: ProjectStatus,

  priority: ProjectPriority,

  assigneeIds: z.array(z.string()),

  labels: z.array(z.string()),

  dueDate: z.string(),
});

export const CreateProjectBody = z.object({
  title: z.string(),

  description: z.string(),

  status: ProjectStatus,

  priority: ProjectPriority,

  responsibleId: z.string(),

  assigneeIds: z.array(z.string()),

  labels: z.array(z.string()),

  dueDate: z.string(),

  taskItems: z.array(CreateProjectTaskInput).optional(),
});

registry.register('CreateProjectBody', CreateProjectBody);

// =====================
// UPDATE PROJECT
// =====================

export const UpdateProjectBody = CreateProjectBody.partial();

registry.register('UpdateProjectBody', UpdateProjectBody);

// =====================
// CREATE TASK
// =====================

export const CreateTaskBody = z.object({
  title: z.string(),

  status: ProjectStatus,

  priority: ProjectPriority,

  responsibleId: z.string(),

  assigneeIds: z.array(z.string()),

  labels: z.array(z.string()),

  dueDate: z.string(),
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

export const UpdateTaskStatusBody = z.object({
  status: ProjectStatus,
});

registry.register(
  'UpdateTaskStatusBody',
  UpdateTaskStatusBody,
);

export const CloseProjectBody = z.object({
  status: z.enum(['done', 'review']).default('done'),
});

export const TaskCommentBody = z.object({
  message: z.string().trim().min(1).max(2_000),
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
  comments: z.array(TaskComment),
  history: z.array(TaskHistoryEntry),
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
        projectIds: z.array(z.string()),
        count: z.number(),
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
// ERROR
// =====================

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()),
  }),
});

registry.register('ApiError', ApiError);
