import {Router, Request, Response} from 'express';
import {
    registry,
    ProjectIdParams,
    ApiError,
} from '../../openapi-registry';

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

router.delete('/:projectId', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
    });
});

export default router;