import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, CreateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
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
  withCreatedProjectRollback,
} from './project_helpers';
import { requireAssignableUsers, requireManagerRole } from './project_access';
import { appendTaskHistory, updateProjectRecord } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 500, 502] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: 'post',
  path: '/projects',
  tags: ['Projects'],
  summary: 'Create a project',
  description: 'Creates the project, its members, its status and its tasks. `priority`, `labels` and `dueDate` are accepted but not persisted by Project API (they are derived from the tasks): the response is the re-read state. If a step fails, the project is deleted again.',

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
    ...apiErrorResponses(...ERROR_STATUSES),
    201: {
      description: 'Project created, as re-read from Project API',
      content: {
        'application/json': {
          schema: ProjectDetailsResponse,
        },
      },
    },

    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ErrorResponse,
        },
      },
    },
  },
});

router.post('/', async (req: Request, res: Response) => {
  const bodyResult = CreateProjectBody.safeParse(req.body);

  if (!bodyResult.success) {
    return sendValidationError(res, 'body', bodyResult.error.issues);
  }

  try {
    const user = requireManagerRole(res);
    if (!user) return;
    if (!await requireAssignableUsers(res, user, [bodyResult.data.responsibleId, ...bodyResult.data.assigneeIds])) return;
    const createdProject = await createProjectOnApi(mapProjectCreateBodyToBackend(bodyResult.data));
    const projectId = createdProject.project_id;

    // Project API has no atomic creation: the members, the status and the tasks are written one call at a
    // time, and the project is deleted again if one of them fails.
    const bundle = await withCreatedProjectRollback(projectId, async () => {
      const memberIds = [bodyResult.data.responsibleId, ...bodyResult.data.assigneeIds].filter(Boolean);
      if (memberIds.length > 0) await syncProjectUsersOnApi(projectId, memberIds);
      // A new project is Active ("in-progress"); only a closed or suspended status needs a write.
      if (bodyResult.data.status === 'done' || bodyResult.data.status === 'review') {
        await updateProjectRecord(projectId, { status: bodyResult.data.status });
      }
      for (const task of bodyResult.data.taskItems ?? []) {
        await createTaskOnApi(
          projectId,
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

      const created = await fetchProjectBundle(projectId);
      await Promise.all(created.tasks.map((task) =>
        appendTaskHistory(projectId, task.id, user, 'task_created', `Tâche « ${task.title} » créée.`),
      ));
      return created;
    });

    // Only the state Project API persisted is returned: priority, labels and dueDate are not stored and
    // are derived from the tasks.
    return res.status(201).json({
      project: await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
      taskItems: await Promise.all(bundle.tasks.map((task) =>
        buildTaskDtoForUser(user, projectId, task, bundle.users),
      )),
    });
  } catch (error) {
    return handleUnknownError(res, error, ERROR_STATUSES);
  }
});

export default router;
