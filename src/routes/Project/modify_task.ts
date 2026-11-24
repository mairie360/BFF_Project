import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectTaskParams, UpdateTaskBody, ProjectTask, ErrorResponse } from '../../openapi-registry';
import { HttpError, parseRequest } from '@mairie360/bffs-lib';
import {
    mapTaskUpdateBodyToBackend,
    buildTaskDtoForUser,
    patchTaskOnApi,
    requireTaskParams,
} from './project_helpers';
import { requireAssignableUsers, requireTaskManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf, listProjectUsers, getTaskWithMembers } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 409, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}/tasks/{taskId}',
    tags: ['Projects'],
    summary: 'Update an existing task of a project',

    request: {
        params: ProjectTaskParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpdateTaskBody,
                },
            },
        },
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        200: {
            description: 'Task updated',
            content: {
                'application/json': {
                    schema: ProjectTask,
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

        404: {
            description: 'Project or task not found',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },
    },
});

router.patch('/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectTaskParams, req.params, 'params');
    const body = parseRequest(UpdateTaskBody, req.body, 'body');
    const { projectId, taskId } = requireTaskParams(params);
    const caller = callerOf(req, ERROR_STATUSES);

    const { user, projectCanManage } = await requireTaskManagement(caller, getProjectUserContext(res), projectId, taskId);
    await requireAssignableUsers(caller, user, [
        ...(body.responsibleId ? [body.responsibleId] : []),
        ...(body.assigneeIds ?? []),
    // The members of the project can be assigned by whoever manages it (MAIR-1088).
    ], async () => (await listProjectUsers(caller, projectId)).map((member) => member.id));
    const backendPayload = mapTaskUpdateBodyToBackend(body);
    if (Object.keys(backendPayload).length > 0) {
        await patchTaskOnApi(caller, projectId, taskId, backendPayload);
    }

    // The task alone and the members that name its assignee, not every task of the project (MAIR-474).
    const updated = await getTaskWithMembers(caller, projectId, taskId);
    if (!updated) throw new HttpError(404, 'Task not found after update');

    res.status(200).json(buildTaskDtoForUser(user, updated.task, updated.users, projectCanManage));
});

export default router;
