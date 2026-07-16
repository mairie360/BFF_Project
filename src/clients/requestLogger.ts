type RequestLogInput = {
    request: Request;
    id?: string;
    schemaPath?: string;
    params?: unknown;
};

function headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};

    headers.forEach((value, key) => {
        result[key] = value;
    });

    return result;
}

function formatReadError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function readRequestBody(request: Request): Promise<unknown> {
    if (!request.body) {
        return undefined;
    }

    try {
        const body = await request.clone().text();

        if (!body) {
            return '';
        }

        try {
            return JSON.parse(body);
        } catch {
            return body;
        }
    } catch (error) {
        return `[Body illisible: ${formatReadError(error)}]`;
    }
}

export async function logOutgoingRequest(label: string, input: RequestLogInput): Promise<void> {
    console.log(`Requête complète envoyée à l’API ${label}:`, {
        id: input.id,
        schemaPath: input.schemaPath,
        method: input.request.method,
        url: input.request.url,
        headers: headersToRecord(input.request.headers),
        bodyUsed: input.request.bodyUsed,
        cache: input.request.cache,
        credentials: input.request.credentials,
        destination: input.request.destination,
        integrity: input.request.integrity,
        keepalive: input.request.keepalive,
        mode: input.request.mode,
        redirect: input.request.redirect,
        referrer: input.request.referrer,
        referrerPolicy: input.request.referrerPolicy,
        params: input.params,
        body: await readRequestBody(input.request),
    });
}
