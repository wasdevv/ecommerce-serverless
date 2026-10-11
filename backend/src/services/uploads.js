'use strict';

const crypto = require('node:crypto');
const { S3Client } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { AppError } = require('../errors');

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Presigned POST (e não PUT) porque só a policy do POST faz o S3 recusar
// arquivo fora do tamanho declarado (content-length-range). A chave é gerada
// aqui, sempre sob users/<id do token>/ — o cliente não escolhe o caminho.
class UploadService {
  constructor({ uploadsConfig, s3 }) {
    this.config = uploadsConfig;
    this.s3 =
      s3 ||
      new S3Client({
        endpoint: uploadsConfig.endpoint,
        forcePathStyle: Boolean(uploadsConfig.endpoint),
      });
  }

  async presign(userId, { contentType, sizeBytes }) {
    if (!this.config.bucket) throw new AppError(503, 'uploads_unavailable', 'Uploads are not configured');
    const key = `users/${userId}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`;
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.config.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, Math.min(sizeBytes, this.config.maxBytes)],
        ['eq', '$Content-Type', contentType],
        ['eq', '$key', key],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: this.config.expiresSeconds,
    });
    return {
      method: 'POST',
      url,
      fields,
      key,
      maxBytes: Math.min(sizeBytes, this.config.maxBytes),
      expiresAt: new Date(Date.now() + this.config.expiresSeconds * 1000).toISOString(),
    };
  }
}

module.exports = { UploadService, EXTENSIONS };
