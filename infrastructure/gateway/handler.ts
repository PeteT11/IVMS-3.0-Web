import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ALBEvent, ALBResult } from 'aws-lambda';

const page = readFileSync(join(__dirname, 'index.html'), 'utf8');
const hashes = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
const headers = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'pragma': 'no-cache',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'none'", `script-src ${hashes.join(' ')} https://maps.googleapis.com https://maps.gstatic.com`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://*.googleapis.com https://*.gstatic.com https://*.google.com",
    "connect-src https://*.googleapis.com https://*.gstatic.com https://*.google.com",
    "frame-src https://*.google.com", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join('; '),
};

export async function handler(event: ALBEvent): Promise<ALBResult> {
  // AWS resource policy limits invocation to this stack's ALB target group.
  // Do not log the event: it contains bearer tokens and authentication cookies.
  if (!event.requestContext?.elb?.targetGroupArn) {
    return { statusCode: 403, headers, body: 'Forbidden' };
  }
  if (!['GET', 'HEAD'].includes(event.httpMethod)) {
    return { statusCode: 405, headers: { ...headers, allow: 'GET, HEAD' }, body: '' };
  }
  if (!['/', '/index.html'].includes(event.path)) {
    return { statusCode: 404, headers, body: 'Not found' };
  }
  return { statusCode: 200, headers, body: event.httpMethod === 'HEAD' ? '' : page, isBase64Encoded: false };
}
