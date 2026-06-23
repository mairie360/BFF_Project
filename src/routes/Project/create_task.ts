import {Router, Request, Response} from 'express';
import {
    registry,
    ProjectIdParams,
    CreateTaskBody,
    ProjectTask,
    ApiError,
} from '../../openapi-registry';

const router = Router();

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/tasks',
    tags: ['Projects'],
    summary: 'Crée une nouvelle tâche pour un projet existant',

    request: {
        params: ProjectIdParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: CreateTaskBody,
                },
            },
        },
    },

    responses: {
        201: {
            description: 'Tâche créée avec succès',
            content: {
                'application/json': {
                    schema: ProjectTask,
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

router.post('/:projectId/tasks', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
    });
});

export default router;