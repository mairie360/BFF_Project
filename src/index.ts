import express from 'express';
import healthRouter from './routes/health';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = process.env.PORT;

if (!PORT) {
  console.error('Error: PORT environment variable is not set.');
  process.exit(1);
}

app.use('/health', healthRouter);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
