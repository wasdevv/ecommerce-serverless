-- Schema inicial. Dinheiro sempre em centavos (integer) e moeda única (BRL).

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Unicidade sem diferenciar maiúsculas: "Ana@x.com" e "ana@x.com" são a mesma conta.
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents > 0),
  -- A constraint é a última linha de defesa contra estoque negativo; o UPDATE
  -- condicional em orders.js é a primeira.
  stock integer NOT NULL CHECK (stock >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_created_at_idx ON products (created_at, id);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed')),
  total_cents integer NOT NULL CHECK (total_cents > 0),
  currency char(3) NOT NULL DEFAULT 'BRL',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_id_created_at_idx ON orders (user_id, created_at DESC);

CREATE TABLE order_items (
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  PRIMARY KEY (order_id, product_id)
);

-- Idempotency-Key é por usuário: a mesma string de dois usuários não colide.
CREATE TABLE idempotency_keys (
  user_id uuid NOT NULL REFERENCES users (id),
  key text NOT NULL,
  request_hash text NOT NULL,
  order_id uuid REFERENCES orders (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Transactional outbox: o evento nasce na mesma transação do pedido e o
-- dispatcher o publica no SQS depois. published_at NULL = pendente.
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (created_at) WHERE published_at IS NULL;

-- Deduplicação do worker: SQS entrega ao menos uma vez.
CREATE TABLE processed_events (
  event_id uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Efeito do worker. Nenhum email é enviado: o registro é a prova do processamento.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES orders (id),
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'recorded',
  created_at timestamptz NOT NULL DEFAULT now()
);
