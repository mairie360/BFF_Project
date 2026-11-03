import { useSessionPublicKey } from './session-keys';

// MAIR-680: every test app verifies the session tokens with Core's public key, like a deployment once the HS256
// transition is over (no JWT_SECRET); the fixtures sign them with Core's test key (bffs-lib requireSession).
useSessionPublicKey();
