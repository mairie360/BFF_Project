import { Router, Request, Response } from 'express';
import { apiErrorResponses, registry, DeletedProjectIdParams, ApiError } from '../../openapi-registry';
import { deleteProjectOnApi, handleUnknownError, parsePublicId, sendValidationError } from './project_helpers';
import { requireProjectManagement } from './project_access';

const router = Router();

registry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Supprime un projet existant',

    request: {
        params: DeletedProjectIdParams,
    },

    responses: {
        ...apiErrorResponses(400, 401, 403, 404, 500, 502),
        204: {
            description: 'Projet supprimé avec succès',
        },

        404: {
            description: 'Projet introuvable',
            content: {
                'application/json': {
                    schema: ApiError,
                },
            },
        },
    },
});

router.delete('/:projectId', async (req: Request, res: Response) => {
    const paramsResult = DeletedProjectIdParams.safeParse(req.params);

    if (!paramsResult.success) {
        return sendValidationError(res, paramsResult.error.issues);
    }

    const projectId = parsePublicId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, [
            {
                code: 'invalid_format',
                path: ['projectId'],
                message: 'projectId must end with a numeric identifier',
            },
        ]);
    }

    try {
        const user = await requireProjectManagement(res, projectId);
        if (!user) return;
        await deleteProjectOnApi(projectId);
        return res.status(204).send();
    } catch (error) {
        return handleUnknownError(res, error);
    }
});

export default router;
