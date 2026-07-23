mod config;
mod gcp;

use fastly::http::{Method, StatusCode};
use fastly::{Error, Request, Response};

const LOGENDPOINT: &str = "papertrail";

#[fastly::main]
fn main(mut req: Request) -> Result<Response, Error> {
    //set logstreaming
    log_fastly::init_simple(LOGENDPOINT, log::LevelFilter::Error);
    fastly::log::set_panic_endpoint(LOGENDPOINT).unwrap();

    // Handle the authorized request
    match (req.get_method(), req.get_path()) {
        (&Method::GET, "/api/v1/top_rising_terms") => Ok(gcp::handle_get_req(&req)?),
        (&Method::POST, "/api/v1/top_rising_terms") => Ok(gcp::handle_insert_req(&mut req)?),

        // Catch all other requests and return a 404.
        _ => Ok(Response::from_status(StatusCode::NOT_FOUND)),
    }
}
