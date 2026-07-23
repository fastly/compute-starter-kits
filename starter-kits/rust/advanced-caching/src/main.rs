//! Default Compute template program.

use fastly::http::header;
use fastly::{mime, Body, Error, Request, Response};
use serde_json::Value;
use std::time::Duration;

/// The entry point for your application.
///
/// This function is triggered when your service receives a client request. It could be used to
/// route based on the request properties (such as method or path), send the request to a backend,
/// make completely new requests, and/or generate synthetic responses.
///
/// If `main` returns an error, a 500 error response will be delivered to the client.
#[fastly::main]
fn main(mut req: Request) -> Result<Response, Error> {
    // Log service version
    println!(
        "FASTLY_SERVICE_VERSION: {}",
        std::env::var("FASTLY_SERVICE_VERSION").unwrap_or_else(|_| String::new())
    );

    // ## Advanced Caching use case: Modifying a request as it is forwarded to a backend

    // Sometimes it is useful to perform modifications to the incoming Request before invoking the
    // origin through the readthrough cache. Call Request::set_before_send() to define a before-send
    // callback function, an operation to be performed just before the readthrough cache would
    // invoke the backend.
    //
    // For details on the before-send callback function, see
    // https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#modifying-a-request-as-it-is-forwarded-to-a-backend

    req.set_before_send(|req| {
        println!("in before-send callback function");

        // Example: Inject headers before sending
        //
        // In this example, we use the before-send callback function to add an authorization header.
        // If building the header is an expensive operation, then it makes sense to add this
        // header only if the request would make it to the backend.
        let auth_header = "Foo".to_string();
        req.set_header(header::AUTHORIZATION, auth_header);

        Ok(())
    });

    // ## Advanced Caching use case: Controlling cache behavior based on backend response

    // Sometimes it is useful to perform operations based on the backend response. Call
    // Request::set_after_send() to define an after-send callback function, an operation that runs
    // only when the readthrough cache has received a response from the backend, before it is
    // (potentially) stored into the cache.
    //
    // The CandidateResponse object passed to the callback represents the response from the backend
    // and contains interfaces to read and manipulate headers and cache policy. It intentionally
    // does not allow reading or writing directory the response body (more on that later).
    //
    // For details on the after-send callback function, see
    // https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#controlling-cache-behavior-based-on-backend-response

    req.set_after_send(|resp| {
        println!("in after-send callback function");

        // Example: Customize caching based on content type
        //
        // This example shows usages that utilize some members of CandidateResponse.
        //
        // * CandidateResponse::set_ttl() - override the Time to Live (TTL) of the object in the cache
        // * CandidateResponse::set_uncacheable(false) - specify that this object is not to be stored in the cache
        //
        // For details on CandidateResponse, see
        // https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#the-candidateresponse-object
        match resp.get_header_str("Content-Type") {
            Some("image") => resp.set_ttl(Duration::from_secs(67)),
            Some("text/html") => resp.set_ttl(Duration::from_secs(321)),
            Some("application/xml") => resp.set_uncacheable(false),
            _ => resp.set_ttl(Duration::from_secs(30)),
        }

        // Example: Creating a hit-for-pass object
        //
        // By specifying true when calling CandidateResponse::set_uncacheable(), you mark the
        // request as "hit-for-pass", which is a marker in the cache to disable request collapsing
        // for this object until a cacheable response is returned.
        if resp.contains_header("my-private-header") {
            resp.set_uncacheable(true);
        }

        // Example: Manipulating the response body that is stored to the cache
        //
        // In an after-send callback, optionally use the CandidateResponse::set_body_transform()
        // method to set a body-transform callback. When the cache interface receives the response
        // body from the backend, it invokes the body-transform callback, passing in the Body that
        // contains the response received from the backend and a StreamingBody for your callback
        // to use to write out the transformed body. This transformed body is stored into the cache
        // and returned to the client from the send operation.
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

        if Some(mime::APPLICATION_JSON) == resp.get_content_type() {
            resp.set_content_type(mime::TEXT_HTML);
            resp.set_body_transform(|body_in, body_out| {
                println!("in body-transform callback function");

                let json: Value = serde_json::from_str(&body_in.into_string()).unwrap();

                let first_name = json["firstName"].as_str().unwrap_or_default();
                let last_name = json["lastName"].as_str().unwrap_or_default();
                let html = format!("<div>{} {}</div>", first_name, last_name);

                body_out.append(Body::from(html.as_bytes()));

                Ok(())
            });
        }

        Ok(())
    });

    Ok(req.send("origin")?)
}
