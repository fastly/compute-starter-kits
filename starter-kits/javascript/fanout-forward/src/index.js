/// <reference types="@fastly/js-compute" />

import { env } from "fastly:env";
import { createFanoutHandoff } from "fastly:fanout";

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

  let useFanout = false;
  if (
    request.method === 'GET' &&
    request.headers.get('upgrade')?.split(',').some(x => x.trim() === 'websocket')
  ) {
    // If a GET request contains "Upgrade: websocket" in its headers, then hand off to Fanout
    // to handle as WebSocket-over-HTTP.
    // For details on WebSocket-over-HTTP, see https://pushpin.org/docs/protocols/websocket-over-http/
    useFanout = true;
  } else if (request.method === 'GET' || request.method === 'HEAD') {
    // If it's a GET or HEAD request, then hand off to Fanout.
    // The backend response can include GRIP control messages to specify connection behavior.
    // For details on GRIP, see https://pushpin.org/docs/protocols/grip/.

    // NOTE: In an actual app we would be selective about which requests are handed off to Fanout,
    // because requests that are handed off to Fanout do not pass through the Fastly cache.
    // For example, we may examine the request path or the existence of certain headers.
    // See https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/#what-to-hand-off-to-fanout

    // TODO: add any additional conditions before setting useFanout to true

    useFanout = true;
  }

  if (useFanout) {
    // createFanoutHandoff creates a special "Response" that, when processed by
    // event.respondWith(), will "hand off" the request through Fanout, to the specified backend.
    return createFanoutHandoff(request, "origin");
  }

  // Send the request to the specified backend normally.
  return fetch(request, { backend: "origin" });
}
