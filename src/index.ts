import express from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import healthRouter from './routes/health';
import checkApis from './routes/check_apis';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = process.env.PORT;

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BFF API',
      version: '1.0.0',
      description: 'Documentation du BFF gérant la vérification des services',
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Serveur local',
      },
    ],
  },
  // On pointe vers les fichiers contenant les annotations @openapi
  apis: ['./src/routes/*.ts'], 
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Route pour l'interface visuelle
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Route pour l'extraction JSON (utilisée par l'Action Composite)
app.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

if (!PORT) {
  console.error('Error: PORT environment variable is not set.');
  process.exit(1);
}

app.use('/health', healthRouter);
app.use('/check_apis', checkApis);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
