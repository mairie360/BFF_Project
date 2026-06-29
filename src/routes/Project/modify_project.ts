import { Router, Request, Response } from 'express';
import {
    registry,
    ProjectIdParams,
    UpdateProjectBody,
    ProjectDetailsResponse,
    ApiError,
} from '../../openapi-registry';

const router = Router();

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Met à jour un projet existant',

    request: {
        params: ProjectIdParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpdateProjectBody,
                },
            },
        },
    },

    responses: {
        200: {
            description: 'Projet mis à jour avec succès',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
                },
            },
        },

        400: {
            description: 'Erreur de validation',
            content: {
                'application/json': {
                    schema: ApiError,
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

router.patch('/:projectId', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
    });
});

export default router;