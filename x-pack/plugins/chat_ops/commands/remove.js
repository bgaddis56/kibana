/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import client from '../lib/es_client';

export default () => ({
  help: 'Remove a command that has been stored with `store`',
  example: 'remove myCommand',
  fn: args => {
    const name = args.trim();

    if (!name) throw new Error('name is required');

    return client
      .delete({
        index: '.moostme',
        type: 'doc',
        id: name,
      })
      .then(() => `Ok done, I removed the stored command \`${name}\``)
      .catch(resp => resp.message);
  },
});
