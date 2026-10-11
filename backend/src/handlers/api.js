'use strict';

const serverlessExpress = require('@codegenie/serverless-express');
const { createApp } = require('../app');
const { getRuntime } = require('../runtime');

let proxy;

// Handler da HTTP API (payload 2.0). O mesmo app Express do ambiente local,
// adaptado pelo serverless-express: nenhuma porta é aberta na Lambda.
exports.handler = async (event, context) => {
  if (!proxy) proxy = serverlessExpress({ app: createApp(await getRuntime()) });
  return proxy(event, context);
};
