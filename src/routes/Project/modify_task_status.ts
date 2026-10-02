import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectTaskParams, UpdateTaskStatusBody, ProjectTask, ErrorResponse } from '../../openapi-registry';
import {
    fetchProjectBundle,
    handleUnknownError,
    sendError,
    buildTaskDtoForUser,
    mapTaskStatusToBackend,
    patchTaskOnApi,
    parseProjectId,
    parseTaskId,
    sendValidationError,
} from './project_helpers';
import { requireTaskStatusUpdate } from './project_access';
import { appendTaskHistory } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502] as const satisfies readonly ApiErrorStatus[];

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
    const paramsResult = ProjectTaskParams.safeParse(req.params);
    const bodyResult = UpdateTaskStatusBody.safeParse(req.body);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
    }

    if (!bodyResult.success) {
        return sendValidationError(res, 'body', bodyResult.error.issues);
    }

    const projectId = parseProjectId(paramsResult.data.projectId);
    const taskId = parseTaskId(paramsResult.data.taskId);

    if (projectId === null || taskId === null) {
        return sendValidationError(res, 'params', [
            {
                message: 'projectId and taskId must be project-<id> and task-<id> identifiers',
            },
        ]);
    }

    try {
        const access = await requireTaskStatusUpdate(res, projectId, taskId);
        if (!access) return;
        const { user, task } = access;

        await patchTaskOnApi(projectId, taskId, {
            status: mapTaskStatusToBackend(bodyResult.data.status),
        });
        await appendTaskHistory(
            projectId,
            taskId,
            user,
            'status_changed',
            `Statut de « ${task.title} » modifié en ${bodyResult.data.status}.`,
            { status: { from: task.status, to: bodyResult.data.status } },
        );

        const updatedBundle = await fetchProjectBundle(projectId);
        const updatedTask = updatedBundle.tasks.find((entry) => entry.id === taskId);

        if (!updatedTask) {
            return sendError(res, 404, 'Task not found after update');
        }

        return res.status(200).json(
            await buildTaskDtoForUser(user, projectId, updatedTask, updatedBundle.users),
        );
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
