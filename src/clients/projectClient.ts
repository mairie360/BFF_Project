// src/clients/projectClient.ts
import createClient from "openapi-fetch";
import type { paths } from "@mairie360/project-api-openapi"; 

const projectClient = createClient<paths>({ 
    baseUrl: process.env.PROJECT_API_URL 
});

export default projectClient;