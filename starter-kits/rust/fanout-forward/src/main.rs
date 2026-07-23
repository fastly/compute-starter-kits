use fastly::http::{HeaderValue, Method};
use fastly::{Error, Request};

fn main() -> Result<(), Error> {
    // Log service version.
    println!(
        "FASTLY_SERVICE_VERSION: {}",
        std::env::var("FASTLY_SERVICE_VERSION").unwrap_or_else(|_| String::new())
    );

    let req = Request::from_client();

    let mut use_fanout = false;

    if req.get_method() == Method::GET
        && req
            .get_header_all("upgrade")
            .any(|value| value == HeaderValue::from_static("websocket"))
    {
        // If a GET request contains "Upgrade: websocket" in its headers, then hand off to Fanout
        // to handle as WebSocket-over-HTTP.
        // For details on WebSocket-over-HTTP, see https://pushpin.org/docs/protocols/websocket-over-http/
        use_fanout = true;
    } else if req.get_method() == Method::GET || req.get_method() == Method::HEAD {
        // If it's a GET or HEAD request, then hand off to Fanout.
        // The backend response can include GRIP control messages to specify connection behavior.
        // For details on GRIP, see https://pushpin.org/docs/protocols/grip/.

        // NOTE: In an actual app we would be selective about which requests are handed off to Fanout,
        // because requests that are handed off to Fanout do not pass through the Fastly cache.
        // For example, we may examine the request path or the existence of certain headers.
        // See https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/#what-to-hand-off-to-fanout

        // TODO: add any additional conditions before setting use_fanout to true

        use_fanout = true;
    }

    if use_fanout {
        // Hand off the request through Fanout to the specified backend.
        req.handoff_fanout("origin")?
    } else {
        // Send the request to the specified backend normally.
        req.send("origin")?.send_to_client()
    }

    Ok(())
}
