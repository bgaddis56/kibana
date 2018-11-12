/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import { token } from '../config.json';
import slack from './slack';

export async function uploadToSlack(options) {
  const payload = { ...options, token };
  return await slack.files.upload(payload);
}
