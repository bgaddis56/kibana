/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import client from '../lib/es_client';
import run from '../run';

export default (server) => ({
  help: 'Run a command that has been stored with `store`',
  example: 'recall mycommand',
  fn: (args, message, handlers) => {
    const name = args.trim();

    if (!name) throw new Error('name is required');

    return client
      .get({
        index: '.moostme',
        type: 'doc',
        id: name,
      })
      .then(doc => {
        return run(doc._source.command, message, handlers, server);
      })
      .catch(resp => resp.message);
  },
});
