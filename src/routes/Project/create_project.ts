import { Router, Request, Response } from 'express';
import { registry, CreateProjectBody, ProjectDetailsResponse, ApiError } from '../../openapi-registry';
import {
  buildProjectResponseFromState,
  buildProjectResponseOverridesFromCreateBody,
  buildTaskResponseFromState,
  createProjectOnApi,
  createTaskOnApi,
  fetchProjectBundle,
  handleUnknownError,
  mapProjectCreateBodyToBackend,
  mapTaskInputToBackend,
  sendValidationError,
} from './project_helpers';

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
    const createdProject = await createProjectOnApi(mapProjectCreateBodyToBackend(bodyResult.data));

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
    const projectResponse = buildProjectResponseFromState({
      project: bundle.project,
      tasks: bundle.tasks,
      users: bundle.users,
      override: buildProjectResponseOverridesFromCreateBody(bodyResult.data),
    });

    return res.status(201).json({
      project: projectResponse,
      taskItems: bundle.tasks.map((task) =>
        buildTaskResponseFromState({
          task,
          users: bundle.users,
        }),
      ),
    });
  } catch (error) {
    return handleUnknownError(res, error);
  }
});

export default router;

