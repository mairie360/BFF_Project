import { JWT_SECRET } from './project-fixtures';

// Every test app verifies the session tokens with the secret the fixtures sign them with (bffs-lib requireSession).
process.env.JWT_SECRET = JWT_SECRET;
