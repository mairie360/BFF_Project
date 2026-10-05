import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectTaskParams, UpdateTaskStatusBody, ProjectTask, ErrorResponse } from '../../openapi-registry';
import { HttpError, parseRequest } from '@mairie360/bffs-lib';
import {
    fetchProjectBundle,
    buildTaskDtoForUser,
    mapTaskStatusToBackend,
    patchTaskOnApi,
    requireTaskParams,
} from './project_helpers';
import { requireTaskStatusUpdate } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { appendTaskHistory, callerOf } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}/tasks/{taskId}/status',
    tags: ['Projects'],
    summary: 'Met à jour le statut d’une tâche existante pour un projet',

    request: {
        params: ProjectTaskParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpdateTaskStatusBody,
                },
            },
        },
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        200: {
            description: 'Statut de la tâche mis à jour avec succès',
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

router.patch('/:projectId/tasks/:taskId/status', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectTaskParams, req.params, 'params');
    const body = parseRequest(UpdateTaskStatusBody, req.body, 'body');
    const { projectId, taskId } = requireTaskParams(params);
    const caller = callerOf(req, ERROR_STATUSES);

    const { user, task } = await requireTaskStatusUpdate(caller, getProjectUserContext(res), projectId, taskId);
    await patchTaskOnApi(caller, projectId, taskId, {
        status: mapTaskStatusToBackend(body.status),
    });
    await appendTaskHistory(
        caller,
        projectId,
        taskId,
        'status_changed',
        `Statut de « ${task.title} » modifié en ${body.status}.`,
        { status: { from: task.status, to: body.status } },
    );

    const updatedBundle = await fetchProjectBundle(caller, projectId);
    const updatedTask = updatedBundle.tasks.find((entry) => entry.id === taskId);
    if (!updatedTask) throw new HttpError(404, 'Task not found after update');

    res.status(200).json(buildTaskDtoForUser(user, updatedTask, updatedBundle.users));
});

export default router;
