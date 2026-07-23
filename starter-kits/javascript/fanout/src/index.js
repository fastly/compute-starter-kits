/// <reference types="@fastly/js-compute" />

import { env } from "fastly:env";
import { createFanoutHandoff } from "fastly:fanout";
import { gripResponse, wsSubscribe } from "./fanoutUtil.js";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

/**
 * @param {FetchEvent} event
 */
async function handleRequest(event) {
  // Log service version.
  console.log('FASTLY_SERVICE_VERSION: ', env('FASTLY_SERVICE_VERSION') || 'local');

  const request = event.request;
  const path = new URL(request.url).pathname;

  const host = request.headers.get('host');
  if (host == null) {
    return new Response(
      'Unknown host\n',
      {
        status: 404,
      },
    );
  }

  const address = event.client.address;
  if (address != null) {
    request.headers.set('X-Forwarded-For', address);
  }

  if (isTls(request)) {
    request.headers.set('X-Forwarded-Proto', 'https');
  }

  // Request is a test request
  if (path.startsWith('/test/')) {

    if (request.headers.has('Grip-Sig')) {
      // Request is from Fanout, handle it here
      return await handleTest(request, 'test');
    }

    // Not from Fanout, route it through Fanout first
    return createFanoutHandoff(request, 'self');
  }

  // Forward all non-test requests to the origin through Fanout
  return createFanoutHandoff(request, 'origin');
}

/**
 * @param {Request} request
 */
function isTls(request) {
  return new URL(request.url).protocol === 'https';
}

/**
 * @param {Request} request
 * @param {string} channel
 */
async function handleTest(request, channel) {
  const path = new URL(request.url).pathname;

  switch(path) {
    case '/test/long-poll':
      return gripResponse('text/plain', 'response', channel);
    case '/test/stream':
      return gripResponse('text/plain', 'stream', channel);
    case '/test/sse':
      return gripResponse('text/event-stream', 'stream', channel);
    case '/test/websocket':
      return await handleFanoutWebSocket(request, channel);
    default:
      return new Response('No such test endpoint\n', { status: 404 });
  }
}

/**
 * @param {Request} request
 * @param {string} channel
 */
async function handleFanoutWebSocket(request, channel) {
  if (request.headers.get('Content-Type') !== 'application/websocket-events') {
    return new Response('Not a WebSocket-over-HTTP request.\n', { status: 400 });
  }

  // Stream in the request body
  const reqBody = new Uint8Array(await request.arrayBuffer());

  // Components to build the response
  const respBodySegments = [
    reqBody, // echo the request body into the response
  ];
  /** @var {Record<string, string>} */
  const respHeaders = {
    'Content-Type': 'application/websocket-events',
  };

  // Is it an open message?
  const OPEN_MESSAGE_BYTES = new TextEncoder().encode('OPEN\r\n');
  if (
    reqBody.length >= OPEN_MESSAGE_BYTES.length &&
    reqBody.slice(0, OPEN_MESSAGE_BYTES.length).every((b, i) => b === OPEN_MESSAGE_BYTES.at(i))
  ) {
    // Subscribe it to the channel
    respBodySegments.push(wsSubscribe(channel));

    // Sec-WebSocket-Extension 'grip' - https://pushpin.org/docs/protocols/grip/#websocket
    // "In order to enable GRIP functionality, the backend must include the grip extension in its response."
    respHeaders['Sec-WebSocket-Extensions'] = 'grip; message-prefix=""';
  }

  // Stream out the response body
  const respBody = new ReadableStream({
    /** @param {ReadableStreamController<Uint8Array>} controller */
    start(controller) {
      for (const segment of respBodySegments) {
        controller.enqueue(segment);
      }
      controller.close();
    },
  });

  return new Response(
    respBody,
    {
      status: 200,
      headers: respHeaders,
    },
  );
}
