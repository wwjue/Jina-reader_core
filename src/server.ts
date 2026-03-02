import Fastify from 'fastify';
import { readUrl, searchGoogle, closeBrowser } from './index.js';
import type { SearchOptions } from './types.js';

export async function startServer(port = 3000) {
    const app = Fastify({ logger: true, forceCloseConnections: true });

    app.get<{
        Querystring: { q?: string; num?: string; page?: string; gl?: string; hl?: string };
    }>('/search', async (request, reply) => {
        const { q, num, page, gl, hl } = request.query;

        if (!q) {
            return reply.status(400).send({ error: 'Missing required query parameter: q' });
        }

        const options: SearchOptions = {};
        if (num) options.num = parseInt(num, 10);
        if (page) options.page = parseInt(page, 10);
        if (gl) options.gl = gl;
        if (hl) options.hl = hl;

        try {
            const results = await searchGoogle(q, options);
            return { results };
        } catch (err: any) {
            request.log.error(err);
            return reply.status(500).send({ error: err.message || 'Search failed' });
        }
    });

    app.get<{
        Querystring: { url?: string; timeout?: string };
    }>('/read', async (request, reply) => {
        const { url, timeout } = request.query;

        if (!url) {
            return reply.status(400).send({ error: 'Missing required query parameter: url' });
        }

        try {
            const result = await readUrl(url, {
                timeout: timeout ? parseInt(timeout, 10) : undefined,
            });
            return result;
        } catch (err: any) {
            request.log.error(err);
            return reply.status(500).send({ error: err.message || 'Read failed' });
        }
    });

    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));

    await app.listen({ port, host: '0.0.0.0' });
    return app;
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
    startServer(parseInt(process.env.PORT || '3000', 10));
}
