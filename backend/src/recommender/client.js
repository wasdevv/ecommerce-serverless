'use strict';

const { InvokeEndpointCommand, SageMakerRuntimeClient } = require('@aws-sdk/client-sagemaker-runtime');

// Dois transportes para o mesmo contrato JSON (ver ml/recommender/inference.py):
//   SageMaker -> InvokeEndpoint no endpoint serverless (AWS)
//   HTTP      -> POST /invocations no serve.py (docker compose)
// Os dois devolvem { recommendations: [{ productId, score }], modelVersion }.
// O timeout é curto de propósito: recomendação é opcional, e a API prefere
// responder com os mais vendidos a segurar a requisição esperando o modelo.

function parse(text) {
  const body = JSON.parse(text);
  // JSON.parse aceita "[]" e "null": só um objeto com a lista é resposta válida.
  if (!body || typeof body !== 'object' || !Array.isArray(body.recommendations)) {
    throw new Error('recommender returned an unexpected body');
  }
  return body;
}

class SageMakerRecommender {
  constructor({ endpointName, timeoutMs, client = new SageMakerRuntimeClient({}) }) {
    this.endpointName = endpointName;
    this.timeoutMs = timeoutMs;
    this.client = client;
    this.kind = 'sagemaker';
  }

  async recommend({ productIds, k }) {
    const out = await this.client.send(
      new InvokeEndpointCommand({
        EndpointName: this.endpointName,
        ContentType: 'application/json',
        Accept: 'application/json',
        Body: JSON.stringify({ productIds, k }),
      }),
      { abortSignal: AbortSignal.timeout(this.timeoutMs) },
    );
    return parse(new TextDecoder().decode(out.Body));
  }
}

class HttpRecommender {
  constructor({ url, timeoutMs }) {
    this.url = `${url.replace(/\/$/, '')}/invocations`;
    this.timeoutMs = timeoutMs;
    this.kind = 'http';
  }

  async recommend({ productIds, k }) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productIds, k }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`recommender answered ${res.status}`);
    return parse(await res.text());
  }
}

// Sem endpoint nem URL configurados não há cliente: a API serve só o fallback.
function createRecommender({ endpointName, url, timeoutMs }) {
  if (endpointName) return new SageMakerRecommender({ endpointName, timeoutMs });
  if (url) return new HttpRecommender({ url, timeoutMs });
  return null;
}

module.exports = { createRecommender, SageMakerRecommender, HttpRecommender };
