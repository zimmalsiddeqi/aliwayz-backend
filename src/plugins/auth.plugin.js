'use strict';

const fp = require('fastify-plugin');
const appConfig = require('../config/app.config');

async function authPlugin(fastify) {
  // Register JWT plugin without namespace
  // This decorates fastify with:
  //   fastify.jwt.sign()
  //   fastify.jwt.verify()
  //   fastify.jwt.decode()
  //   request.jwtVerify()
  await fastify.register(require('@fastify/jwt'), {
    secret: appConfig.jwt.secret,
    sign: {
      algorithm: 'HS256',
      expiresIn: appConfig.jwt.accessExpiresIn,
    },
    verify: {
      algorithms: ['HS256'],
    },
  });
}

module.exports = fp(authPlugin, {
  name: 'auth-plugin',
});