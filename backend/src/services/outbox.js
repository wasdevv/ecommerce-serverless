'use strict';

const { SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const { withTransaction } = require('../db/pool');

const SQS_BATCH_LIMIT = 10;

// Publica eventos pendentes da outbox no SQS. Roda dentro de uma transação com
// FOR UPDATE SKIP LOCKED: duas execuções simultâneas do dispatcher pegam linhas
// diferentes, e se o processo morrer antes do COMMIT as linhas voltam a ficar
// pendentes. Garantia: ao menos uma vez — o worker deduplica pelo event id.
async function dispatchPending({ db, sqs, queueUrl, limit = 50, log }) {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT id, event_type, payload, correlation_id FROM outbox_events
       WHERE published_at IS NULL ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    let published = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += SQS_BATCH_LIMIT) {
      const chunk = rows.slice(i, i + SQS_BATCH_LIMIT);
      let result;
      try {
        result = await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: chunk.map((row, index) => ({
              Id: String(index),
              MessageBody: JSON.stringify({ eventId: row.id, type: row.event_type, data: row.payload }),
              MessageAttributes: row.correlation_id
                ? { correlationId: { DataType: 'String', StringValue: row.correlation_id } }
                : undefined,
            })),
          }),
        );
      } catch (error) {
        // Falha do lote inteiro: registra a tentativa e deixa pendente.
        await client.query(
          'UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = ANY($1::uuid[])',
          [chunk.map((r) => r.id), error.message.slice(0, 500)],
        );
        failed += chunk.length;
        log?.warn({ err: error.message, events: chunk.length }, 'outbox publish failed, will retry');
        continue;
      }

      const ok = (result.Successful || []).map((s) => chunk[Number(s.Id)].id);
      const bad = (result.Failed || []).map((f) => chunk[Number(f.Id)].id);
      if (ok.length) {
        await client.query('UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::uuid[])', [ok]);
      }
      if (bad.length) {
        await client.query(
          "UPDATE outbox_events SET attempts = attempts + 1, last_error = 'sqs entry failed' WHERE id = ANY($1::uuid[])",
          [bad],
        );
      }
      published += ok.length;
      failed += bad.length;
    }
    return { scanned: rows.length, published, failed };
  });
}

module.exports = { dispatchPending };
