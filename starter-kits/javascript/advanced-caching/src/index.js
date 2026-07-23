/// <reference types="@fastly/js-compute" />

import { env } from "fastly:env";
import { CacheOverride } from "fastly:cache-override";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

async function handleRequest(event) {

  // Log service version.
  console.log('FASTLY_SERVICE_VERSION: ', env('FASTLY_SERVICE_VERSION') || 'local');

  // To apply advanced caching features, instantiate CacheOverride and set it as the cacheOverride option
  // when calling fetch().

  const backendResp = await fetch(
    event.request, {
      backend: 'origin',
      cacheOverride: new CacheOverride({
        // ## Advanced Caching use case: Modifying a request as it is forwarded to a backend
        //
        // Sometimes it is useful to perform modifications to the incoming Request before invoking the
        // origin through the readthrough cache. Define the beforeSend() function on the CacheOverride initializer
        // to define a before-send callback function, an operation to be performed just before the readthrough
        // cache would invoke the backend.
        //
        // For details on the before-send callback function, see
        // https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#modifying-a-request-as-it-is-forwarded-to-a-backend
        beforeSend(req) {
          console.log('in before-send callback function');

          // Example: Inject headers before sending
          //
          // In this example, we use the before-send callback function to add an authorization header.
          // If building the header is an expensive operation, then it makes sense to add this
          // header only if the request would make it to the backend.
          const authHeader = 'Foo'; // Suppose this is an expensive operation
          req.headers.set('Authorization', authHeader);
        },
        // ## Advanced Caching use case: Controlling cache behavior based on backend response
        //
        // Sometimes it is useful to perform operations based on the backend response. Define the afterSend()
        // function on the CacheOverride initializer to define an after-send callback function, an operation that runs
        // only when the readthrough cache has received a response from the backend, before it is
        // (potentially) stored into the cache.
        //
        // The CandidateResponse object passed to the callback represents the response from the backend
        // and contains interfaces to read and manipulate headers and cache policy. It intentionally
        // does not allow reading or writing directory the response body (more on that later).
        //
        // For details on the after-send callback function, see
        // https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#controlling-cache-behavior-based-on-backend-response
        afterSend(resp) {
          console.log('in after-send callback function');

          // Example: Customize caching based on content type
          //
          // This shows an example of setting Response.prototype.ttl to override the Time to Live (TTL) of the
          // object to be stored in the cache.
          //
          // This also shows an example of returning { cache: false } from the after-send callback to specify that
          // this object is not to be stored in the cache.
          //
          // For details on customizing cache behavior, see
          // https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#the-candidateresponse-object
          let cache = undefined;
          switch (resp.headers.get('Content-Type')) {
          case 'image':
            resp.ttl = 67;
            break;
          case 'text/html':
            resp.ttl = 321;
            break;
          case 'application/xml':
            // We are returning this value at the end of this function; see return statement below.
            cache = false;
            break;
          default:
            resp.ttl = 2;
          }

          // Example: Creating a hit-for-pass object
          //
          // By returning { cache: 'uncacheable' } from the after-send callback, you mark the
          // request as "hit-for-pass", which is a marker in the cache to disable request collapsing
          // for this object until a cacheable response is returned.
          if (resp.headers.has('my-private-header')) {
            // We are returning this value at the end of this function; see return statement below.
            cache = 'uncacheable';
          }

          // Example: Manipulating the response body that is stored to the cache
          //
          // Optionally include a bodyTransformFn value in the object returned from the after-send callback
          // function to set a body-transform callback. When the cache interface receives the response
          // body from the backend, it invokes the body-transform callback. The original backend body
          // is passed in to the transform function, and the function is expected to return the new body.
          //
          // The transformation is declared in this way rather than directly working with the body
          // during the after-send callback function, because not every response contains a fresh
          // body. Specifically, 304 Not Modified responses, which are used to revalidate a stale
          // cached response, are valuable precisely because they do not retransmit the body; in
          // this case, the backend and (if specified) your after-send callback function update
          // the headers and cache policy of the existing response object "in-place", without
          // applying the body-transform or changing the cached response body.
          //
          // This design enables the readthrough cache to internally manage the complexities of
          // revalidation, allowing the developer to provide a single code path without needing
          // to think about revalidation at all.
          //
          // In this example, a transformation is made from JSON content to an HTML snippet
          // and saved to the cache.
          //
          // For details on the body-transform callback function, see
          // https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#modifying-the-body-that-is-saved-to-the-cache
          let bodyTransformFn = undefined;
          if (resp.headers.get('Content-Type') === 'application/json') {
            resp.headers.set('Content-Type', 'text/html');
            // We are returning this value at the end of this function; see return statement below.
            bodyTransformFn = (bytes) => {
              const str = new TextDecoder().decode(bytes);

              const json = JSON.parse(str);
              const firstName = json['firstName'];
              const lastName = json['lastName'];

              const html = `<div>${firstName} ${lastName}</div>`;

              return new TextEncoder().encode(html);
            };
          }

          // Return the values of cache and bodyTransformFn set by the above example code.
          return {
            cache,
            bodyTransformFn,
          };
        }
      }),
    }
  );

  return backendResp;
}
