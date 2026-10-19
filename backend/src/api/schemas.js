'use strict';

const Joi = require('joi');
const { EXTENSIONS } = require('../services/uploads');

const email = Joi.string().email({ tlds: false }).max(254).lowercase().trim();

// Corpo JSON tem tipo: "2" não é quantidade. strict() desliga a coerção do
// Joi nos números do body (na query string a coerção é necessária).
const num = () => Joi.number().strict();

const pagination = Joi.object({
  page: Joi.number().integer().min(1).max(10_000).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = {
  register: Joi.object({
    email: email.required(),
    password: Joi.string().min(8).max(128).required(),
  }),
  login: Joi.object({
    email: email.required(),
    password: Joi.string().max(128).required(),
  }),
  pagination,
  idParam: Joi.object({ id: Joi.string().guid().required() }),
  productCreate: Joi.object({
    sku: Joi.string().trim().min(1).max(64).required(),
    name: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().max(2000).allow(''),
    priceCents: num().integer().positive().max(100_000_000).required(),
    stock: num().integer().min(0).max(1_000_000).required(),
  }),
  productUpdate: Joi.object({
    name: Joi.string().trim().min(1).max(200),
    description: Joi.string().max(2000).allow(''),
    priceCents: num().integer().positive().max(100_000_000),
    stock: num().integer().min(0).max(1_000_000),
  }).min(1),
  // Sem campo de preço: o cliente informa só produto e quantidade.
  orderCreate: Joi.object({
    items: Joi.array()
      .items(
        Joi.object({
          productId: Joi.string().guid().required(),
          quantity: num().integer().min(1).max(100).required(),
        }),
      )
      .min(1)
      .max(50)
      .unique('productId')
      .required(),
  }),
  recommendations: Joi.object({
    limit: Joi.number().integer().min(1).max(20).default(5),
  }),
  assistantAsk: Joi.object({
    question: Joi.string().trim().min(3).max(500).required(),
  }),
  idempotencyKey: Joi.string().pattern(/^[A-Za-z0-9._:-]{8,128}$/).required(),
  // Sem campo de chave/caminho: o servidor decide onde o arquivo vai.
  uploadPresign: (maxBytes) =>
    Joi.object({
      contentType: Joi.string()
        .valid(...Object.keys(EXTENSIONS))
        .required(),
      sizeBytes: num().integer().min(1).max(maxBytes).required(),
    }),
};
