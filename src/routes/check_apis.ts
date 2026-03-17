import { Router } from 'express';
import axios from 'axios'; // La lib utilisée

const router = Router();

// Récupération des variables d'environnement
const core_api_url = process.env.CORE_API_URL;
const core_api_port = process.env.CORE_API_PORT;

const project_api_url = process.env.PROJECT_API_URL;
const project_api_port = process.env.PROJECT_API_PORT;

const CORE_FULL_URL = `http://${core_api_url}:${core_api_port}`;
const PROJECT_FULL_URL = `http://${project_api_url}:${project_api_port}`;

router.get('/', async (_, res) => {
  try {
    const coreResponse = await axios.get(`${CORE_FULL_URL}/health`, { timeout: 5000 });
    console.log(coreResponse);
    const core_is_reachable = coreResponse.status === 200;
    
    const projectResponse = await axios.get(`${PROJECT_FULL_URL}/health`, { timeout: 5000 });
    console.log(projectResponse);
    const project_is_reachable = projectResponse.status === 200;
    
    res.status(200).json({
      status: 'OK',
      core_api: core_is_reachable ? 'Connected' : 'Unreachable',
      project_api: project_is_reachable ? 'Connected' : 'Unreachable',
      details: {
        core: coreResponse.data,
        project: projectResponse.data
      }
    });
  } catch (error) {
    res.status(502).json({
      status: 'Error',
      core_api: 'Unreachable',
      project_api: 'Unreachable',
      message: (error as Error).message
    });
  }
});

export default router;