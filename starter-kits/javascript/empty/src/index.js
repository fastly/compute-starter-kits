/// <reference types="@fastly/js-compute" />

import { enforceExplicitBackends } from "fastly:backend";

// As a basic security precaution, all Compute services written in
// JavaScript should disable the use of implicitly-created dynamic
// backends.
enforceExplicitBackends();

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

async function handleRequest(event) {
  return new Response("OK", { status: 200 });
}
