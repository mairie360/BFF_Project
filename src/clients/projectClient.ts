// src/clients/projectClient.ts
import createClient from 'openapi-fetch';
import dotenv from 'dotenv';
dotenv.config();

function defaultBasePath(host: string): string {
    if (process.env.PROJECT_API_BASE_PATH !== undefined) {
        return process.env.PROJECT_API_BASE_PATH;
    }

    const hasProtocol = /^https?:\/\//.test(host);
    const hasPath = host.includes('/');

    return hasProtocol || hasPath ? '' : '/api';
}

function buildBaseUrl(host = 'localhost', port?: string): string {
    const url = new URL(/^https?:\/\//.test(host) ? host : `http://${host}`);

    if (port && !url.port) {
        url.port = port;
    }

    const basePath = defaultBasePath(host);
    if (basePath) {
        url.pathname = `${url.pathname.replace(/\/$/, '')}/${basePath.replace(/^\//, '')}`;
    }

    return url.toString().replace(/\/$/, '');
}

const projectApiBaseUrl = buildBaseUrl(process.env.PROJECT_API_URL, process.env.PROJECT_API_PORT);

console.log(`Project API client initialized with base URL: ${projectApiBaseUrl}`);

const projectClient = createClient<Record<string, any>>({
    baseUrl: projectApiBaseUrl,
});


export default projectClient;
