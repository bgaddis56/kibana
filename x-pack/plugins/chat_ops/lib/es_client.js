/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import { Client } from 'elasticsearch';
//import { es } from '../config.json';
const client = new Client({ host: 'localhost:9200',
  httpAuth: 'elastic:changeme'
});

export default client;
