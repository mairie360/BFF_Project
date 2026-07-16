// src/clients/coreClient.ts
import createClient from 'openapi-fetch';

const coreClient = createClient<Record<string, never>>({
    baseUrl: process.env.CORE_API_URL,
});

export default coreClient;
