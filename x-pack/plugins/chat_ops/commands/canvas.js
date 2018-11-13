/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import fetch from 'axios';
import rison from 'rison-node';

export default (server) => ({
  help: 'Run a canvas expression and get an image back',
  example: 'demodata | render',
  fn: args => {
    args = args.replace(/[\u2018\u2019]/g, '\'').replace(/[\u201C\u201D]/g, '"');

    const reportURL = `/app/canvas#/workpad/workpad-${encodeURIComponent(args.trim())}`;

    const chatconfig = {
      browserTimezone: 'America/Phoenix',
      layout: {
        dimensions: {
          width: 640,
          height: 480,
        },
        id: 'preserve_layout',
      },
      objectType: 'canvas workpad',
      relativeUrls: [reportURL],
      title: 'Foo',
    };

    const encoded = rison.encode(chatconfig);

    const URL2 = `http://localhost:5601/api/reporting/generate/printablePdf?jobParams=${encodeURIComponent(
      encoded
    )}`;

    const config = server.config();
    const chatusername = config.get('xpack.chatops.userid');
    const chatuserpwd = config.get('xpack.chatops.userpwd');

    const data = chatusername + ':' + chatuserpwd;
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
                      title: 'Canvas Element',
                      file: resp.data,
                      filename: 'canvas.png',
                      type: 'png',
                      initial_comment: `Output of:           
\`\`\`
${args.trim()}
\`\`\``,
                    },
                  });
                })
                .catch(() => {
                  if (!timeout) {
                    resolve(
                      'Expression timed out. Well, probably totally failed, but who knows. Sorry. Write better code next time dingus.'
                    );
                    return;
                  }

                  console.log('WAITING FOR REPORT....');
                  poll();
                });
            }, 2000);
          }

          poll();
        })
        .catch(e => {
          resolve(`OOPS: ${e}`);
        });
    });
  },
});
