import {Router, Request, Response} from 'express';
import {
    registry,
    ProjectTaskParams,
    ApiError,
} from '../../openapi-registry';

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

router.delete('/:projectId/tasks/:taskId', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
    });
});

export default router;