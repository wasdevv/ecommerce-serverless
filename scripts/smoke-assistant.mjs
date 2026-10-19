#!/usr/bin/env node
// Smoke do assistente contra a stack local, depois de seed e index:products.
// Sem chave da Anthropic (como no CI) a resposta vem só da busca híbrida;
// com chave, do LLM — nos dois casos a caneca tem que aparecer.
//
//   node scripts/smoke-assistant.mjs http://localhost:3000

import { randomUUID } from 'node:crypto';

const base = `${(process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')}/api/v1`;
const json = { 'content-type': 'application/json' };

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const email = `assistant-smoke-${randomUUID().slice(0, 8)}@example.com`;
const password = randomUUID();
await fetch(`${base}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
if (login.status !== 200) fail(`login -> ${login.status}`);
const auth = { authorization: `Bearer ${(await login.json()).data.accessToken}` };

const res = await fetch(`${base}/assistant`, {
  method: 'POST',
  headers: { ...json, ...auth },
  body: JSON.stringify({ question: 'Vocês têm caneca pra cafe?' }),
});
const source = res.headers.get('x-assistant-source');
const body = await res.json();
const skus = body.data?.products.map((p) => p.sku) ?? [];
console.log(`assistant -> ${res.status} source=${source} ${skus.join(' ')}`);
console.log(`  "${body.data?.answer}"`);
if (res.status !== 200) fail('expected 200');
if (!['llm', 'retrieval'].includes(source)) fail(`unexpected source ${source}`);
if (!skus.includes('MUG-001')) fail('expected MUG-001 in the answer');
console.log('ASSISTANT_OK');
