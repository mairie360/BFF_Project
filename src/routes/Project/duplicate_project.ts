import {Router, Request, Response} from 'express';
import {
    registry,
    ProjectIdParams,
    ProjectDetailsResponse,
    ApiError,
} from '../../openapi-registry';

const router = Router();

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/duplicate',
    tags: ['Projects'],
    summary: 'Duplique un projet existant',

    request: {
        params: ProjectIdParams,
    },

    responses: {
        201: {
            description: 'Projet dupliqué avec succès',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
                },
            },
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

router.post('/:projectId/duplicate', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
    });
});

export default router;