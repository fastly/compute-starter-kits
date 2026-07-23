#include <iostream>
#include <fastly/sdk.h>
using namespace std::literals;

constexpr char welcome_page[] = {
    #embed "welcome-to-compute.html"
    , 0
};

int send_fatal_error_to_client() {
    fastly::Response::from_status(500).send_to_client();
    return 1;
}

/// The entry point for your application.
///
/// This function is triggered when your service receives a client request. It could be used to
/// route based on the request properties (such as method or path), send the request to a backend,
/// make completely new requests, and/or generate synthetic responses.
int main() {
    // Log service version
    std::cout << "FASTLY_SERVICE_VERSION: " << std::getenv("FASTLY_SERVICE_VERSION") << std::endl;

    auto req = fastly::Request::from_client();

    switch (req.get_method()) {
    case fastly::http::Method::POST:
    case fastly::http::Method::PUT:
    case fastly::http::Method::PATCH:
    case fastly::http::Method::DELETE: {
        auto res = fastly::Response::from_status(405);
        if (!res.append_header("ALLOW", "GET, HEAD, PURGE")) {
            return send_fatal_error_to_client();
        }
        res.set_body("This method is not allowed\n");
        res.send_to_client();
        return 0;
    }
    default: {
        // Let any other requests through
    }
    }

    // Determine what to do based on the path:
    auto path = req.get_path();
    if (path == "/"sv) {
        // If request is to the `/` path...
        // Below are some common patterns for Compute services using C++.
        // Head to https://www.fastly.com/documentation/guides/compute/developer-guides/cpp/ to discover more.

        // Create a new request.
        // auto bereq = fastly::Request::get("https://httpbin.org/headers");
        // if (!bereq.set_header("X-Custom-Header", "Welcome to Compute!")) {
        //     return send_fatal_error_to_client();
        // }
        // bereq.set_ttl(60);

        // Add request headers.
        // if (!bereq.set_header(
        //     "X-Another-Custom-Header",
        //     "Recommended reading: https://developer.fastly.com/learning/compute"
        // )) {
        //     return send_fatal_error_to_client();
        // }

        // Forward the request to a backend.
        // auto beresp = bereq.send("backend_name");
        // if (!beresp) {
        //     return send_fatal_error_to_client();
        // }

        // Remove response headers.
        // if (!beresp->remove_header("X-Another-Custom-Header")) {
        //     return send_fatal_error_to_client();
        // }

        // Log to a Fastly endpoint.
        // auto endpoint = fastly::log::Endpoint::from_name("my_endpoint");
        // endpoint << "Hello from the edge!" << std::endl;

        // Send a default synthetic response.
        fastly::Response::from_status(200)
            .with_content_type("text/html; charset=utf-8")
            .with_body(welcome_page)
            .send_to_client();
        return 0;
    // } else if (path == "/about"sv) {
        // Handle other paths...
    //
    }

    // Catch all other requests and return a 404.
    auto res = fastly::Response::from_status(404);
    if (!res.set_body_text_plain("The page you requested could not be found\n")) {
        return send_fatal_error_to_client();
    }
    res.send_to_client();
    return 0;
}
