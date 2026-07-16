import { Router, Request, Response } from 'express';
import { registry, ProjectTaskParams, ApiError } from '../../openapi-registry';
import { deleteTaskOnApi, handleUnknownError, parsePublicId, sendValidationError } from './project_helpers';
import { requireTaskManagement } from './project_access';

const router = Router();

registry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}/tasks/{taskId}',
    tags: ['Projects'],
    summary: 'Supprime une tâche existante pour un projet',

    request: {
        params: ProjectTaskParams,
    },

    responses: {
        204: {
            description: 'Tâche supprimée avec succès',
        },

        404: {
            description: 'Projet ou tâche introuvable',
            content: {
                'application/json': {
                    schema: ApiError,
                },
            },
        },
    },
});

router.delete('/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const paramsResult = ProjectTaskParams.safeParse(req.params);

    if (!paramsResult.success) {
        return sendValidationError(res, paramsResult.error.issues);
    }

    const projectId = parsePublicId(paramsResult.data.projectId);
    const taskId = parsePublicId(paramsResult.data.taskId);

    if (projectId === null || taskId === null) {
        return sendValidationError(res, [
            {
                code: 'invalid_format',
                path: ['projectId', 'taskId'],
                message: 'projectId and taskId must end with numeric identifiers',
            },
        ]);
    }

    try {
        const user = await requireTaskManagement(res, projectId, taskId);
        if (!user) return;
        await deleteTaskOnApi(projectId, taskId);
        return res.status(204).send();
    } catch (error) {
        return handleUnknownError(res, error);
    }
});

export default router;
