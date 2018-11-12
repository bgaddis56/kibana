/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import fetch from 'axios';
//import rison from 'rison-node';

export default () => ({
  help: 'Get a snapshot of a dashboard back',
  example: 'dashboard 722b74f0-b882-11e8-a6d9-e546fe2bba5f',
  fn: args => {
    args = args.replace(/[\u2018\u2019]/g, '\'').replace(/[\u201C\u201D]/g, '"');

    /* const dashboardID = args.split(' ')[0];
    const dashboardURL = `/app/kibana#/dashboards`;

   const config = {
      browserTimezone: 'America/Phoenix',
      layout: {
        dimensions: {
          width: 960,
          height: 720,
        },
      },
      objectType: 'canvas workpad',
      relativeUrl: dashboardURL,
      title: 'Foo',
    };

    const encoded = rison.encode(config);*/

    const URL2 = 'http://localhost:5601/app/kibana#/dashboards';

    const data = 'elastic:changeme';
    const buff = new Buffer(data);
    const base64data = buff.toString('base64');

    return new Promise(resolve => {
      fetch(URL2, {
        method: 'GET',
        headers: { 'kbn-xsrf': 'test me',
          Authorization: 'Basic ' + base64data }
      })
        .then(resp => {
          resolve({
            type: 'file',
            value: {
              title: 'Kibana Dashboard List',
              content: resp.data,
              filename: 'dashboards.html',
              filetype: 'html',
              initial_comment: `Output of \`${args.trim()}\``,
            }
          });
        })
        .catch(e => {
          console.error(e);
          resolve(`OOPS: ${e}`);
        });
    });
  },
});
