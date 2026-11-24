import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, CreateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
  buildProjectDtoForUser,
  buildBundleTaskDtos,
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
import { callerOf, setProjectClosed } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: 'post',
  path: '/projects',
  tags: ['Projects'],
  summary: 'Create a project',
  description: 'Creates the project with its status and priority (stored as chosen, MAIR-558), then its members and its tasks. `dueDate` is recorded by Project API as the deadline of the project (the day it was written for) and read back as entered; `labels` are accepted but not persisted: the response is the re-read state. If a step fails, the project is deleted again. `groupId` links a group whose current and future members all see the project: an unknown group, or one the caller may not link, answers `404` and creates nothing.',

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

    404: {
      description: 'Unknown group, or a group the caller may not link (`GET /project-groups`)',
      content: {
        'application/json': {
          schema: ErrorResponse,
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
  const { status, ...created } = mapProjectCreateBodyToBackend(body);
  // A closed project is read-only (its members and tasks could no longer be written): a project created `done` is
  // created open and closed once its members and tasks are written.
  const closeAtTheEnd = status === 'Completed';
  const createdProject = await createProjectOnApi(caller, closeAtTheEnd ? created : { ...created, ...(status ? { status } : {}) });
  const projectId = createdProject.project_id;

  // Project API has no atomic creation: the members and the tasks are written one call at a time, and the
  // project is deleted again if one of them fails. The status and the priority go with the creation (MAIR-558).
  const bundle = await withCreatedProjectRollback(caller, projectId, async () => {
    const memberIds = [body.responsibleId, ...body.assigneeIds].filter(Boolean);
    // The responsible is written as a `manager`: the project reads its first manager as its responsible.
    if (memberIds.length > 0) await syncProjectUsersOnApi(caller, projectId, memberIds, undefined, [body.responsibleId]);
    for (const task of body.taskItems ?? []) {
      // Sequential on purpose: Project API numbers the tasks in creation order, which must be the order given.
      // eslint-disable-next-line no-await-in-loop
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
    if (closeAtTheEnd) await setProjectClosed(caller, projectId, 'Completed');

    return fetchProjectBundle(caller, projectId);
  });

  // Only the state Project API persisted is returned: labels are not stored.
  res.status(201).json({
    project: buildProjectDtoForUser(user, bundle),
    taskItems: buildBundleTaskDtos(user, bundle),
  });
});

export default router;
