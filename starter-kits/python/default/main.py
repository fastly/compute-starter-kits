import os
import pathlib

from fastly_compute.wsgi import WsgiHttpIncoming
from flask import Flask

app = Flask(__name__)

# Module-level functionality executes at build-time as part of
# memory snapshotting; the filesystem is not available at runtime; instead
# execution of the code resumes from this snapshot when an incoming
# request is received, greatly reducing startup costs.
welcome_page_path = pathlib.Path(__file__).parent / "welcome-to-compute.html"
welcome_page = welcome_page_path.read_text(encoding="utf-8")


@app.before_request
def log_service_version():
    # Log service version
    print(f"FASTLY_SERVICE_VERSION: {os.environ.get('FASTLY_SERVICE_VERSION', '')}")


@app.route("/", methods=["GET"])
def index():
    # Below are some common patterns for Compute services using Python.
    # Head to https://www.fastly.com/documentation/guides/compute/developer-guides/python/ to discover more.

    # 1. Sending HTTP Requests (via requests facade)
    # The Fastly SDK for Python provides a requests-compatible facade.
    # Outgoing requests can use dynamic backends (by passing a full URL)
    # or static backends (by specifying `fastly_backend`).
    #
    # Example:
    # from fastly_compute import requests
    #
    # # Using dynamic backends:
    # resp = requests.get("https://http-me.fastly.dev/get")
    #
    # # Using a static backend named "example-backend":
    # resp = requests.get(
    #     "https://example.com/api/data",
    #     headers={"X-Custom-Header": "Welcome!"},
    #     fastly_backend="example-backend"
    # )

    # 2. Real-Time Log Streaming (Logging)
    # The SDK provides direct integration with Fastly's Real-Time Log Streaming endpoints,
    # both via direct endpoint writing and standard Python library logging.
    #
    # Example 1: Direct endpoint logging
    # from fastly_compute.log import LogEndpoint
    #
    # with LogEndpoint.open("my-log-endpoint") as endpoint:
    #     endpoint.write("Hello from the edge!")
    #
    # Example 2: Integration with Python standard library `logging`
    # import logging
    # from fastly_compute.log import FastlyLogHandler
    #
    # handler = FastlyLogHandler(default_endpoint="my-log-endpoint")
    # logger = logging.getLogger("my-app")
    # logger.addHandler(handler)
    # logger.info("This is an info-level log message")

    return welcome_page, 200, {"Content-Type": "text/html; charset=utf-8"}


# Create the HTTP handler using WSGI; this adapts the Fastly Compute
# platform to the WSGI standard for use with a variety of frameworks.
HttpIncoming = WsgiHttpIncoming(app)
