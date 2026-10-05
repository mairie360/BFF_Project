import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectTaskParams, UpdateTaskBody, ProjectTask, ErrorResponse } from '../../openapi-registry';
import { HttpError, parseRequest } from '@mairie360/bffs-lib';
import {
    fetchProjectBundle,
    mapTaskUpdateBodyToBackend,
    buildTaskDtoForUser,
    patchTaskOnApi,
    requireTaskParams,
} from './project_helpers';
import { requireAssignableUsers, requireTaskManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { appendTaskHistory, callerOf } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}/tasks/{taskId}',
    tags: ['Projects'],
    summary: 'Met à jour une tâche existante pour un projet',

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
            description: 'Tâche mise à jour avec succès',
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

    const { user, task } = await requireTaskManagement(caller, getProjectUserContext(res), projectId, taskId);
    await requireAssignableUsers(caller, user, [
        ...(body.responsibleId ? [body.responsibleId] : []),
        ...(body.assigneeIds ?? []),
    ]);
    const backendPayload = mapTaskUpdateBodyToBackend(body);
    if (Object.keys(backendPayload).length > 0) {
        await patchTaskOnApi(caller, projectId, taskId, backendPayload);
    }
    await appendTaskHistory(
        caller,
        projectId,
        taskId,
        'task_updated',
        `Tâche « ${body.title ?? task.title} » modifiée.`,
        body,
    );

    const updatedBundle = await fetchProjectBundle(caller, projectId);
    const updatedTask = updatedBundle.tasks.find((entry) => entry.id === taskId);
    if (!updatedTask) throw new HttpError(404, 'Task not found after update');

    res.status(200).json(buildTaskDtoForUser(user, updatedTask, updatedBundle.users));
});

export default router;
