/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import fetch from 'axios';
import rison from 'rison-node';

export default () => ({
  help: 'Get a snapshot of a dashboard back',
  example: 'dashboard 722b74f0-b882-11e8-a6d9-e546fe2bba5f',
  fn: args => {
    args = args.replace(/[\u2018\u2019]/g, '\'').replace(/[\u201C\u201D]/g, '"');

    const dashboardID = args.split(' ')[0];
    const dashboardURL = `/app/kibana#/dashboard/${dashboardID}`;

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

    const encoded = rison.encode(config);

    const URL2 = `http://localhost:5601/api/reporting/generate/png?jobParams=${encodeURIComponent(
      encoded
    )}`;

    const data = 'elastic:changeme';
    const buff = new Buffer(data);
    const base64data = buff.toString('base64');

    return new Promise(resolve => {
      fetch(URL2, {
        method: 'POST',
        headers: { 'kbn-xsrf': 'test me',
          Authorization: 'Basic ' + base64data }
      })
        .then(resp => {
          const fullPath = `http://localhost:5601${resp.data.path}`;
          let timeout = 20;

          function poll() {
            timeout--;
            setTimeout(() => {
              fetch(fullPath, { responseType: 'stream',
                headers: { 'kbn-xsrf': 'test me',
                  Authorization: 'Basic ' + base64data }
              })
                .then(resp => {
                  resolve({
                    type: 'file',
                    value: {
                      title: 'Kibana Dashboard',
                      file: resp.data,
                      filename: 'dashboard.png',
                      type: 'png',
                      initial_comment: `Output of \`${args.trim()}\``,
                    },
                  });
                })
                .catch(() => {
                  if (!timeout) {
                    resolve(
                      'Dashboard timed out. I wish I could tell you more. I just...I just don\'t know what happened.'
                    );
                    return;
                  }
                  poll();
                });
            }, 2000);
          }

          poll();
        })
        .catch(e => {
          console.error(e);
          resolve(`OOPS: ${e}`);
        });
    });
  },
});
