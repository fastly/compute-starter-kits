/// <reference types="@fastly/js-compute" />

import { env } from 'fastly:env';
import * as React from 'react';
import * as Server from 'react-dom/server.edge';

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

async function handleRequest(event) {

  // Log service version
  console.log("FASTLY_SERVICE_VERSION:", env('FASTLY_SERVICE_VERSION') || 'local');

  const Greet = () => <h1>Hello, world!</h1>;
  return new Response(
    await Server.renderToReadableStream(<Greet />),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html'
      },
    },
  );
}
