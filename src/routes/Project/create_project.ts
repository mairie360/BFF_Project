import { Router, Request, Response } from 'express';
import { registry, CreateProjectBody, ProjectDetailsResponse, ApiError } from '../../openapi-registry';
import {
  buildProjectResponseOverridesFromCreateBody,
  buildProjectDtoForUser,
  buildTaskDtoForUser,
  createProjectOnApi,
  createTaskOnApi,
  fetchProjectBundle,
  handleUnknownError,
  mapProjectCreateBodyToBackend,
  mapTaskInputToBackend,
  sendValidationError,
  syncProjectUsersOnApi,
} from './project_helpers';
import { requireAssignableUsers, requireManagerRole } from './project_access';
import {
  appendTaskHistory,
  createProjectRecord,
  isProjectDatabaseAccessEnabled,
} from '../../repositories/projectRepository';

const router = Router();

registry.registerPath({
  method: 'post',
  path: '/projects',
  tags: ['Projects'],
  summary: 'Créer un projet',

  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: CreateProjectBody,
        },
      },
    },
  },

  responses: {
    201: {
      description: 'Projet créé',
      content: {
        'application/json': {
          schema: ProjectDetailsResponse,
        },
      },
    },

    400: {
      description: 'Erreur de validation',
      content: {
        'application/json': {
          schema: ApiError,
        },
      },
    },
  },
});

router.post('/', async (req: Request, res: Response) => {
  const bodyResult = CreateProjectBody.safeParse(req.body);

  if (!bodyResult.success) {
    return sendValidationError(res, bodyResult.error.issues);
  }

  try {
    const user = requireManagerRole(res);
    if (!user) return;
    if (!await requireAssignableUsers(res, user, [bodyResult.data.responsibleId, ...bodyResult.data.assigneeIds])) return;
    const createdProject = isProjectDatabaseAccessEnabled()
      ? {
          project_id: await createProjectRecord(user.id, {
            title: bodyResult.data.title,
            description: bodyResult.data.description,
          }),
        }
      : await createProjectOnApi(mapProjectCreateBodyToBackend(bodyResult.data));
    await syncProjectUsersOnApi(createdProject.project_id, [
      bodyResult.data.responsibleId,
      ...bodyResult.data.assigneeIds,
    ]);

    if (Array.isArray(bodyResult.data.taskItems)) {
      for (const task of bodyResult.data.taskItems) {
        await createTaskOnApi(
          createdProject.project_id,
          mapTaskInputToBackend({
            title: task.title,
            status: task.status,
            priority: task.priority,
            assigneeIds: task.assigneeIds,
            labels: task.labels,
            dueDate: task.dueDate,
          }),
        );
      }
    }

    const bundle = await fetchProjectBundle(createdProject.project_id);
    await Promise.all(bundle.tasks.map((task) =>
      appendTaskHistory(createdProject.project_id, task.id, user, 'task_created', `Tâche « ${task.title} » créée.`),
    ));
    const baseProject = await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users);
    const projectResponse = {
      ...baseProject,
      ...buildProjectResponseOverridesFromCreateBody(bodyResult.data),
      permissions: baseProject.permissions,
    };

    return res.status(201).json({
      project: projectResponse,
      taskItems: await Promise.all(bundle.tasks.map((task) =>
        buildTaskDtoForUser(user, createdProject.project_id, task, bundle.users),
      )),
    });
  } catch (error) {
    return handleUnknownError(res, error);
  }
});

export default router;
