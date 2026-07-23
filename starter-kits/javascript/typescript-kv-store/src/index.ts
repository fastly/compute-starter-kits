/// <reference types="@fastly/js-compute" />

import { app } from "./app.js";

/**
    Attach a FetchEventListener, this is the entry point to all Fastly Compute JavaScript applications
 */
addEventListener("fetch", (event) => event.respondWith(handleEvent(event)));

async function handleEvent(event: FetchEvent) {

  let response: Response;
  try {
    response = await app(event);
  } catch(error: unknown) {
    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.stack);
    }
    return new Response("Internal Server Error", {status: 500});
  }
  return response;

}
