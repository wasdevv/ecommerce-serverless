'use strict';

const { SQSClient } = require('@aws-sdk/client-sqs');
const { getRuntime } = require('../runtime');
const { dispatchPending } = require('../services/outbox');
const { logger } = require('../observability/logger');
const { newCorrelationId, runWithContext } = require('../observability/context');

const sqs = new SQSClient({});

// Disparado pelo EventBridge Scheduler a cada minuto. Drena a outbox em
// lotes até esvaziar ou até restar pouco tempo de execução.
exports.handler = async (_event, context) => {
  const { config, db } = await getRuntime();
  return runWithContext({ correlationId: newCorrelationId() }, async () => {
    const totals = { scanned: 0, published: 0, failed: 0 };
    for (;;) {
      const batch = await dispatchPending({ db, sqs, queueUrl: config.queue.url, log: logger });
      totals.scanned += batch.scanned;
      totals.published += batch.published;
      totals.failed += batch.failed;
      const outOfTime = context?.getRemainingTimeInMillis && context.getRemainingTimeInMillis() < 10_000;
      if (batch.scanned === 0 || batch.failed > 0 || outOfTime) break;
    }
    logger.info(totals, 'outbox dispatch finished');
    return totals;
  });
};
