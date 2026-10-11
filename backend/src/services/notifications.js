'use strict';

const Joi = require('joi');
const { withTransaction } = require('../db/pool');
const { ORDER_CREATED } = require('./orders');

const eventSchema = Joi.object({
  eventId: Joi.string().guid().required(),
  type: Joi.string().valid(ORDER_CREATED).required(),
  data: Joi.object({
    orderId: Joi.string().guid().required(),
    userId: Joi.string().guid().required(),
    totalCents: Joi.number().integer().positive().required(),
  })
    .unknown(true)
    .required(),
});

class InvalidEventError extends Error {}

function parseEvent(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidEventError('message body is not JSON');
  }
  const { error, value } = eventSchema.validate(parsed);
  if (error) throw new InvalidEventError(error.message);
  return value;
}

// Processa um evento order.created. A marca em processed_events e o efeito
// (notificação) entram na mesma transação: reentrega do SQS encontra a marca e
// vira no-op, e uma falha no meio não deixa marca sem efeito.
async function handleOrderEvent(db, event) {
  return withTransaction(db, async (client) => {
    const mark = await client.query(
      'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [event.eventId],
    );
    if (mark.rowCount === 0) return { duplicate: true };
    await client.query(
      `INSERT INTO notifications (event_id, order_id, user_id, kind)
       VALUES ($1, $2, $3, 'order_confirmation')`,
      [event.eventId, event.data.orderId, event.data.userId],
    );
    return { duplicate: false };
  });
}

module.exports = { handleOrderEvent, parseEvent, InvalidEventError };
