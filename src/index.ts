import app from './app';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT;

if (!PORT) {
  console.error('Error: PORT environment variable is not set.');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
