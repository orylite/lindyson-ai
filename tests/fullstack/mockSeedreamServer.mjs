import { createServer } from 'node:http';

const port = 4400;
const maxRequestBytes = 1024 * 1024;

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== 'POST' || request.url !== '/api/v3/images/generations') {
    writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(request));
    assertSeedreamPayload(payload);
    response.setHeader('x-tt-logid', 'fullstack-seedream-checkpoint-request');
    writeJson(response, 200, {
      model: 'doubao-seedream-5-0-pro-260628',
      created: Math.floor(Date.now() / 1000),
      data: [{
        url: 'https://ark-project.tos-cn-beijing.volces.com/fullstack-checkpoint.png',
        size: '1024x1024',
      }],
      usage: {
        generated_images: 1,
        output_tokens: 12,
        total_tokens: 12,
      },
    });
  } catch (error) {
    writeJson(response, 400, {
      error: {
        code: 'FULLSTACK_SEEDREAM_REQUEST_INVALID',
        message: error instanceof Error ? error.message : 'Invalid request',
      },
    });
  }
});

server.listen(port, '0.0.0.0');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxRequestBytes) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function assertSeedreamPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Payload must be an object');
  if (payload.model !== 'doubao-seedream-5-0-pro-260628') throw new Error('Unexpected model');
  if (payload.size !== '1024x1024') throw new Error('Unexpected size');
  if (payload.output_format !== 'png') throw new Error('Output must be PNG');
  if (payload.response_format !== 'url') throw new Error('Response format must be URL');
  if (payload.watermark !== false) throw new Error('Watermark must be disabled');
  if (payload.optimize_prompt_options?.mode !== 'standard') throw new Error('Unexpected prompt mode');
  if (typeof payload.prompt !== 'string' || !payload.prompt.includes('全栈 checkpoint')) throw new Error('Unexpected prompt');
  if ('image' in payload) throw new Error('Checkpoint regression task must be text-to-image');
  for (const forbidden of ['stream', 'tools', 'sequential_image_generation']) {
    if (forbidden in payload) throw new Error(`Forbidden field: ${forbidden}`);
  }
}

function writeJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
