'use strict';

// Equivalente local do EventBridge + SQS event source mapping: a cada 5 s
// roda o dispatcher da outbox e faz long polling na fila (ElasticMQ no
// docker compose), entregando as mensagens ao mesmo handler do worker.
const { DeleteMessageBatchCommand, ReceiveMessageCommand, SQSClient } = require('@aws-sdk/client-sqs');
const dispatcher = require('../src/handlers/dispatcher');
const worker = require('../src/handlers/worker');
const { getRuntime } = require('../src/runtime');
const { logger } = require('../src/observability/logger');

const sqs = new SQSClient({});

async function pollOnce(queueUrl, db) {
  const { Messages = [] } = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 5,
      MessageAttributeNames: ['All'],
    }),
  );
  if (Messages.length === 0) return;
  // Converte para o formato do evento SQS da Lambda (camelCase).
  const records = Messages.map((m) => ({
    messageId: m.MessageId,
    body: m.Body,
    messageAttributes: Object.fromEntries(
      Object.entries(m.MessageAttributes || {}).map(([k, v]) => [k, { stringValue: v.StringValue }]),
    ),
  }));
  const { batchItemFailures } = await worker.processRecords(db, records);
  const failed = new Set(batchItemFailures.map((f) => f.itemIdentifier));
  const done = Messages.filter((m) => !failed.has(m.MessageId));
  if (done.length) {
    await sqs.send(
      new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: done.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle })),
      }),
    );
  }
}

(async () => {
  const { config, db } = await getRuntime();
  logger.info({ queue: config.queue.url }, 'local jobs started');
  for (;;) {
    try {
      await dispatcher.handler({}, { getRemainingTimeInMillis: () => 60_000 });
      await pollOnce(config.queue.url, db);
    } catch (error) {
      logger.error({ err: error.message }, 'local jobs iteration failed');
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
})();
