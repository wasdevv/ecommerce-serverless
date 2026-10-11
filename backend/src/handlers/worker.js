'use strict';

const { getRuntime } = require('../runtime');
const { handleOrderEvent, parseEvent, InvalidEventError } = require('../services/notifications');
const { logger } = require('../observability/logger');
const { runWithContext, sanitizeCorrelationId } = require('../observability/context');

// Consumidor SQS com partial batch response: cada mensagem é independente.
// A que falhar volta para a fila sozinha e, esgotado o maxReceiveCount, vai
// para a DLQ — sem reprocessar (nem bloquear) as que deram certo no lote.
async function processRecords(db, records) {
  const batchItemFailures = [];
  for (const record of records) {
    const correlationId = sanitizeCorrelationId(record.messageAttributes?.correlationId?.stringValue);
    await runWithContext({ correlationId }, async () => {
      try {
        const event = parseEvent(record.body);
        const { duplicate } = await handleOrderEvent(db, event);
        logger.info({ eventId: event.eventId, messageId: record.messageId, duplicate }, 'order event processed');
      } catch (error) {
        const level = error instanceof InvalidEventError ? 'warn' : 'error';
        logger[level]({ messageId: record.messageId, err: error.message }, 'order event failed');
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }
  return { batchItemFailures };
}

exports.handler = async (event) => {
  const { db } = await getRuntime();
  return processRecords(db, event.Records || []);
};
exports.processRecords = processRecords;
