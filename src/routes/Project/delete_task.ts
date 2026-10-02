import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, DeletedTaskParams, ErrorResponse } from '../../openapi-registry';
import { deleteTaskOnApi, handleUnknownError, parseProjectId, parseTaskId, sendValidationError } from './project_helpers';
import { requireTaskManagement } from './project_access';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}/tasks/{taskId}',
    tags: ['Projects'],
    summary: 'Supprime une tâche existante pour un projet',

    request: {
        params: DeletedTaskParams,
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        204: {
            description: 'Tâche supprimée avec succès',
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

router.delete('/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const paramsResult = DeletedTaskParams.safeParse(req.params);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
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
        if (!await requireTaskManagement(res, projectId, taskId)) return;
        await deleteTaskOnApi(projectId, taskId);
        return res.status(204).send();
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
