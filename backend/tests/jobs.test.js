'use strict';

const { setupTestContext } = require('./helpers');
const { dispatchPending } = require('../src/services/outbox');
const { processRecords } = require('../src/handlers/worker');

let ctx;
beforeAll(async () => {
  ctx = await setupTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

// Duble do SQSClient: guarda o que seria enviado. O que está sob teste é a
// outbox (transação, locks, marcação), não o SDK da AWS.
function fakeSqs(behavior = 'ok') {
  const sent = [];
  return {
    sent,
    async send(command) {
      if (behavior === 'down') throw new Error('connect ETIMEDOUT sqs');
      const entries = command.input.Entries;
      sent.push(...entries.map((e) => JSON.parse(e.MessageBody)));
      if (behavior === 'partial') {
        return { Successful: [{ Id: entries[0].Id }], Failed: entries.slice(1).map((e) => ({ Id: e.Id })) };
      }
      return { Successful: entries.map((e) => ({ Id: e.Id })), Failed: [] };
    },
  };
}

async function placeOrder() {
  const user = await ctx.user();
  const productId = await ctx.product();
  const res = await ctx.http()
    .post('/api/v1/orders')
    .set('Authorization', user.auth)
    .set('Idempotency-Key', `k-${Math.random().toString(36).slice(2)}`)
    .set('X-Correlation-Id', 'corr-order-flow-1')
    .send({ items: [{ productId, quantity: 1 }] })
    .expect(201);
  return res.body.data;
}

const pending = async () =>
  (await ctx.db.query('SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL')).rows[0].n;

const asRecord = (message, messageId) => ({
  messageId,
  body: JSON.stringify(message),
  messageAttributes: { correlationId: { stringValue: 'corr-order-flow-1' } },
});

describe('outbox dispatcher', () => {
  it('recovers an event committed while SQS was unavailable', async () => {
    const order = await placeOrder();

    const down = await dispatchPending({ db: ctx.db, sqs: fakeSqs('down'), queueUrl: 'q' });
    expect(down).toEqual({ scanned: 1, published: 0, failed: 1 });
    expect(await pending()).toBe(1);
    const { rows } = await ctx.db.query('SELECT attempts, last_error FROM outbox_events');
    expect(rows[0]).toMatchObject({ attempts: 1, last_error: 'connect ETIMEDOUT sqs' });

    const sqs = fakeSqs();
    const up = await dispatchPending({ db: ctx.db, sqs, queueUrl: 'q' });
    expect(up).toEqual({ scanned: 1, published: 1, failed: 0 });
    expect(await pending()).toBe(0);
    expect(sqs.sent[0]).toMatchObject({ type: 'order.created', data: { orderId: order.id } });

    // Nada mais a publicar: não reenvia.
    expect(await dispatchPending({ db: ctx.db, sqs, queueUrl: 'q' })).toEqual({ scanned: 0, published: 0, failed: 0 });
  });

  it('keeps individually failed entries pending', async () => {
    await placeOrder();
    await placeOrder();
    const res = await dispatchPending({ db: ctx.db, sqs: fakeSqs('partial'), queueUrl: 'q' });
    expect(res).toEqual({ scanned: 2, published: 1, failed: 1 });
    expect(await pending()).toBe(1);
  });

  it('lets concurrent dispatchers split the work without double publishing', async () => {
    for (let i = 0; i < 4; i++) await placeOrder();
    const a = fakeSqs();
    const b = fakeSqs();
    await Promise.all([
      dispatchPending({ db: ctx.db, sqs: a, queueUrl: 'q', limit: 2 }),
      dispatchPending({ db: ctx.db, sqs: b, queueUrl: 'q', limit: 2 }),
    ]);
    const ids = [...a.sent, ...b.sent].map((m) => m.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('order event worker', () => {
  async function publishedMessage() {
    await placeOrder();
    const sqs = fakeSqs();
    await dispatchPending({ db: ctx.db, sqs, queueUrl: 'q' });
    return sqs.sent[0];
  }

  it('does not duplicate the notification on redelivery', async () => {
    const message = await publishedMessage();
    const first = await processRecords(ctx.db, [asRecord(message, 'm-1')]);
    const redelivered = await processRecords(ctx.db, [asRecord(message, 'm-2')]);

    expect(first.batchItemFailures).toEqual([]);
    expect(redelivered.batchItemFailures).toEqual([]);
    const { rows } = await ctx.db.query('SELECT kind, status FROM notifications');
    expect(rows).toEqual([{ kind: 'order_confirmation', status: 'recorded' }]);
  });

  it('reports only the bad messages of a batch as failures', async () => {
    const message = await publishedMessage();
    const result = await processRecords(ctx.db, [
      { messageId: 'bad-json', body: '{not json' },
      { messageId: 'bad-shape', body: JSON.stringify({ eventId: 'x', type: 'order.created', data: {} }) },
      asRecord(message, 'good'),
      // Evento bem formado mas apontando para pedido inexistente: falha no banco (FK).
      asRecord({ ...message, eventId: '11111111-1111-4111-8111-111111111111', data: { ...message.data, orderId: '22222222-2222-4222-8222-222222222222' } }, 'fk-violation'),
    ]);

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'bad-json' },
      { itemIdentifier: 'bad-shape' },
      { itemIdentifier: 'fk-violation' },
    ]);
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM notifications');
    expect(rows[0].n).toBe(1);
    // A falha não deixou marca de "processado": a reentrega ainda pode ter efeito.
    const marks = await ctx.db.query('SELECT count(*)::int AS n FROM processed_events');
    expect(marks.rows[0].n).toBe(1);
  });
});
