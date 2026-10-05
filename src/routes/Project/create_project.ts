import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, CreateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
  buildProjectDtoForUser,
  buildTaskDtoForUser,
  createProjectOnApi,
  createTaskOnApi,
  fetchProjectBundle,
  mapProjectCreateBodyToBackend,
  mapTaskInputToBackend,
  syncProjectUsersOnApi,
  withCreatedProjectRollback,
} from './project_helpers';
import { parseRequest } from '@mairie360/bffs-lib';
import { requireAssignableUsers, requireManagerRole } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { appendTaskHistory, callerOf, updateProjectRecord } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

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
  const body = parseRequest(CreateProjectBody, req.body, 'body');
  const caller = callerOf(req, ERROR_STATUSES);
  const user = getProjectUserContext(res);

  requireManagerRole(user);
  await requireAssignableUsers(caller, user, [body.responsibleId, ...body.assigneeIds]);
  const createdProject = await createProjectOnApi(caller, mapProjectCreateBodyToBackend(body));
  const projectId = createdProject.project_id;

  // Project API has no atomic creation: the members, the status and the tasks are written one call at a
  // time, and the project is deleted again if one of them fails.
  const bundle = await withCreatedProjectRollback(caller, projectId, async () => {
    const memberIds = [body.responsibleId, ...body.assigneeIds].filter(Boolean);
    if (memberIds.length > 0) await syncProjectUsersOnApi(caller, projectId, memberIds);
    // A new project is Active ("in-progress"); only a closed or suspended status needs a write.
    if (body.status === 'done' || body.status === 'review') {
      await updateProjectRecord(caller, projectId, { status: body.status });
    }
    for (const task of body.taskItems ?? []) {
      await createTaskOnApi(
        caller,
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

    const created = await fetchProjectBundle(caller, projectId);
    await Promise.all(created.tasks.map((task) =>
      appendTaskHistory(caller, projectId, task.id, 'task_created', `Tâche « ${task.title} » créée.`),
    ));
    return created;
  });

  // Only the state Project API persisted is returned: priority, labels and dueDate are not stored and
  // are derived from the tasks.
  res.status(201).json({
    project: buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
    taskItems: bundle.tasks.map((task) => buildTaskDtoForUser(user, task, bundle.users)),
  });
});

export default router;
