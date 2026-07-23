use fastly::http::StatusCode;
use fastly::{Error, Request, Response};

mod fanout_util;

fn handle_fanout_ws(mut req: Request, chan: &str) -> Response {
    if req.get_header_str("Content-Type") != Some("application/websocket-events") {
        return Response::from_status(StatusCode::BAD_REQUEST)
            .with_body("Not a WebSocket-over-HTTP request.\n");
    }

    // Stream in the request body
    let req_body = req.take_body().into_bytes();

    // echo the request body into the response
    let mut resp_body = req_body.clone();

    let mut resp = Response::from_status(StatusCode::OK)
        .with_header("Content-Type", "application/websocket-events");

    // Is it an open message?
    if req_body.len() >= 6 && &req_body[..6] == b"OPEN\r\n" {
        // Subscribe it to the channel
        resp_body.extend(fanout_util::ws_sub(chan));

        // Sec-WebSocket-Extension 'grip' - https://pushpin.org/docs/protocols/grip/#websocket
        // "In order to enable GRIP functionality, the backend must include the grip extension in its response."
        resp.set_header("Sec-WebSocket-Extensions", "grip; message-prefix=\"\"");
    }

    resp.set_body(resp_body);
    resp
}

fn handle_test(req: Request, chan: &str) -> Response {
    match req.get_url().path() {
        "/test/long-poll" => fanout_util::grip_response("text/plain", "response", chan),
        "/test/stream" => fanout_util::grip_response("text/plain", "stream", chan),
        "/test/sse" => fanout_util::grip_response("text/event-stream", "stream", chan),
        "/test/websocket" => handle_fanout_ws(req, chan),
        _ => Response::from_status(StatusCode::NOT_FOUND).with_body("No such test endpoint\n"),
    }
}

fn is_tls(req: &Request) -> bool {
    req.get_url().scheme().eq_ignore_ascii_case("https")
}

fn main() -> Result<(), Error> {
    // Log service version
    println!(
        "FASTLY_SERVICE_VERSION: {}",
        std::env::var("FASTLY_SERVICE_VERSION").unwrap_or_else(|_| String::new())
    );

    let mut req = Request::from_client();

    if req.get_url().host().is_none() {
        Response::from_status(StatusCode::NOT_FOUND)
            .with_body("Unknown host\n")
            .send_to_client();
        return Ok(());
    }

    let path = req.get_path().to_string();

    if let Some(addr) = req.get_client_ip_addr() {
        req.set_header("X-Forwarded-For", addr.to_string());
    }

    if is_tls(&req) {
        req.set_header("X-Forwarded-Proto", "https");
    }

    // Request is a test request
    if path.starts_with("/test/") {
        if req.get_header_str("Grip-Sig").is_some() {
            // Request is from Fanout, handle it here
            handle_test(req, "test").send_to_client();
            return Ok(());
        } else {
            // Not from Fanout, route it through Fanout first
            req.handoff_fanout("self")?;
            return Ok(());
        }
    }

    // Forward all non-test requests to the origin
    Ok(req.handoff_fanout("origin")?)
}
