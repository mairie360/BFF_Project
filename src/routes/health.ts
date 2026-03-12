import { Router } from 'express';
import { registry } from '../openapi-registry';

const router = Router();

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Connectivity'],
  summary: "Vérifie la santé du BFF",
  responses: {
    200: {
      description: 'OK',
    }
  },
});

router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

export default router;