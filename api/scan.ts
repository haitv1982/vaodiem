import type { IncomingMessage, ServerResponse } from 'node:http';
import { runScanRequest } from '../lib/scanCore.js';

interface VercelIncomingMessage extends IncomingMessage {
  body?: unknown;
}

async function parseRequestBody(req: VercelIncomingMessage): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function handler(req: VercelIncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const body = await parseRequestBody(req);
  const result = await runScanRequest({
    imageBase64: typeof body.imageBase64 === 'string' ? body.imageBase64 : '',
    mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg',
    maxStt: typeof body.maxStt === 'number' ? body.maxStt : 60,
    columnLabel: typeof body.columnLabel === 'string' ? body.columnLabel : 'TX1',
  });

  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(result.body));
}
