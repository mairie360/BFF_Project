// src/clients/coreClient.ts
import createClient from "openapi-fetch";
import type { paths } from "@mairie360/core-api-openapi"; 

const coreClient = createClient<paths>({ 
    baseUrl: process.env.CORE_API_URL 
});

export default coreClient;