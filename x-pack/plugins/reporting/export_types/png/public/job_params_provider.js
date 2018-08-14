/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import chrome from 'ui/chrome';
import {
  getUnhashableStatesProvider,
  unhashUrl,
} from 'ui/state_management/state_hashing';
import moment from 'moment-timezone';

export function JobParamsProvider(Private, config) {
  const getUnhashableStates = Private(getUnhashableStatesProvider);

  function parseRelativeUrl(location) {
    // We need to convert the hashed states in the URL back into their original RISON values,
    // because this URL will be sent to the API.
    const unhashedUrl = unhashUrl(location.href, getUnhashableStates());

    const relativeUrl = unhashedUrl.replace(location.origin + chrome.getBasePath(), '');
    return relativeUrl;
  }

  return function jobParams(controller) {
    const browserTimezone = config.get('dateFormat:tz') === 'Browser' ? moment.tz.guess() : config.get('dateFormat:tz');
    const relativeUrl = parseRelativeUrl(window.location);
    const el = document.querySelector('[data-shared-items-container]');
    const bounds = el.getBoundingClientRect();

    return {
      title: controller.getSharingTitle(),
      objectType: controller.getSharingType(),
      browserTimezone: browserTimezone,
      relativeUrls: [ relativeUrl ],
      layout: { id: "preserve_layout",
        dimensions: {
          height: bounds.height,
          width: bounds.width,
        }
      }
    };
  };
}