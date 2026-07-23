/// <reference types="@fastly/js-compute" />

import { env } from 'fastly:env';
import { CacheOverride } from 'fastly:cache-override';
import { createWebsocketHandoff } from 'fastly:websocket';

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

/**
 * Fastly Compute request handler
 *
 * @param { FetchEvent } event
 */
async function handleRequest(event) {

  // Log service version.
  console.log("FASTLY_SERVICE_VERSION: ", env("FASTLY_SERVICE_VERSION") || "local");

  const { request } = event;

  if (request.headers.get('upgrade') === 'websocket') {
    // createWebsocketHandoff creates a special "Response" that, when processed by event.respondWith(), will
    // create a WebSocket tunnel to the specified backend and "hand off" the request through it
    return createWebsocketHandoff(request, 'backend');
  } else {
    // Send the request to the specified backend normally.
    return fetch(request, {
      backend: 'backend',
      cacheOverride: new CacheOverride('pass'),
    });
  }

}
