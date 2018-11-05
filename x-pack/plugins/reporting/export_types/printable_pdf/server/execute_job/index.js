/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import * as Rx from 'rxjs';
import { mergeMap, catchError, map, takeUntil } from 'rxjs/operators';
import { oncePerServer } from '../../../../server/lib/once_per_server';
import { generatePdfObservableFactory } from '../lib/generate_pdf';
import { compatibilityShimFactory } from './compatibility_shim';
import { decryptJobHeaders, omitBlacklistedHeaders, getConditionalHeaders,
  addForceNowQuerystring, getCustomLogo } from '../../../common/execute_job/';

const KBN_SCREENSHOT_HEADER_BLACKLIST = [
  'accept-encoding',
  'content-length',
  'content-type',
  'host',
  'referer',
  // `Transfer-Encoding` is hop-by-hop header that is meaningful
  // only for a single transport-level connection, and shouldn't
  // be stored by caches or forwarded by proxies.
  'transfer-encoding',
];

function executeJobFn(server) {
  const generatePdfObservable = generatePdfObservableFactory(server);
  const compatibilityShim = compatibilityShimFactory(server);

  return compatibilityShim(function executeJob(jobToExecute, cancellationToken) {
    jobToExecute.server = server;
    const process$ = Rx.of(jobToExecute).pipe(
      mergeMap(decryptJobHeaders),
      catchError(() => Rx.throwError('Failed to decrypt report job data. Please re-generate this report.')),
      map(omitBlacklistedHeaders),
      map(getConditionalHeaders),
      mergeMap(getCustomLogo),
      mergeMap(addForceNowQuerystring),
      mergeMap(({ job, conditionalHeaders, logo, urls }) => {
        return generatePdfObservable(job.title, urls, job.browserTimezone, conditionalHeaders, job.layout, logo);
      }),
      map(buffer => ({
        content_type: 'application/pdf',
        content: buffer.toString('base64')
      }))
    );

    const stop$ = Rx.fromEventPattern(cancellationToken.on);

    return process$.pipe(
      takeUntil(stop$)
    ).toPromise();
  });
}

export const executeJobFactory = oncePerServer(executeJobFn);
