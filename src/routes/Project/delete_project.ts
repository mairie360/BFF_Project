import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, ApiError } from '../../openapi-registry';
import { deleteProjectOnApi, handleUnknownError, parsePublicId, sendValidationError } from './project_helpers';

const router = Router();

registry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Supprime un projet existant',

    request: {
        params: ProjectIdParams,
    },

    responses: {
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
    const paramsResult = ProjectIdParams.safeParse(req.params);

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
        await deleteProjectOnApi(projectId);
        return res.status(204).send();
    } catch (error) {
        return handleUnknownError(res, error);
    }
});

export default router;