// src/clients/projectClient.ts
import createClient from 'openapi-fetch';

const projectClient = createClient<Record<string, any>>({
    baseUrl: process.env.PROJECT_API_URL,
});

export default projectClient;