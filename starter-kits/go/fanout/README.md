# Fanout Starter Kit for Go

Install this starter kit to use [Fanout](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/), the real-time message broker operating at Fastly's edge. This starter kit routes incoming requests through the Fanout GRIP proxy and on to an origin. It also provides some endpoints for testing real-time messages without needing an origin.

**For more details about this and other starter kits for Compute, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters/)**.

For the basic case, this starter kit may be used as-is to forward all traffic through Fanout to an origin.

If you would like to implement Fanout logic at the edge, this starter kit is also a good starting point for that, and you can modify it to fit your needs. See the test endpoints for inspiration.

## How it works

For test requests (Paths under `/test/`), the app is actually invoked twice.

1. Initially, a client request arrives at the app without having been routed through the Fanout proxy yet. The app checks for this via the presence of a `Grip-Sig` header. If that header is not present, the app calls `createFanoutHandoff(request, 'self')` and exits. This tells the subsystem that the connection should be routed through Fanout, and is used for HTTP requests controlled by GRIP.

2. Since `self` refers to the same app, a second request is made to the same app, this time coming through Fanout. The app checks for this, and then handles the request accordingly (in `handleTest()`).

Non-test requests are simply forwarded through the Fanout proxy and on to the origin.

> [!IMPORTANT]
> The starter kit forwards all non-test traffic through Fanout to the origin. In a production environment, be selective about the requests you send through Fanout. See [What to hand off to Fanout](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/#what-to-hand-off-to-fanout) for a discussion on this topic.

## Setup

The app expects a configured backend named `"origin"`. It forwards all non-test requests through Fanout to this backend.

Additionally, for the test endpoints to work, the app expects a configured backend named `"self"` that points back to app itself. For example, if the service has a domain `foo.edgecompute.app`, then you'll need to create a backend on the service named `"self"` with the destination host set to `foo.edgecompute.app` and port 443. Also set "Override Host" to the same host value.

### Enabling Fanout

When you create a new service from this starter kit, Fanout is enabled automatically.

To [enable Fanout](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/#enable-fanout) on an existing Fastly service, type:

```shell
fastly products --enable=fanout
```

## Testing locally

To test Fanout features in the local testing environment, first obtain [Pushpin](https://pushpin.org), the open-source GRIP proxy server that Fastly Fanout is based upon, and make sure it is available on the system path.

Create a Fastly Compute project based on this starter kit.

```term
mkdir my-fanout-project
cd my-fanout-project
fastly compute init --from=https://github.com/fastly/compute-starter-kit-go-fanout
```

The `fastly.toml` file included in this starter kit includes a `local_server.pushpin` section:
```toml
[local_server.pushpin]
enable = true
```

Run the starter kit:
```term
fastly compute serve
```

The Fastly CLI starts Pushpin and then starts the starter kit app at http://localhost:7676/.

## Test Endpoints

The app handles requests to the following endpoints at the edge:

* `/test/stream`: HTTP streaming of `text/plain`
* `/test/sse`: SSE (streaming of `text/event-stream`)
* `/test/long-poll`: Long-polling
* `/test/websocket`: bidirectional WebSocket
  * In the example, the WebSocket endpoint is set up to echo back any messages it receives from the client.

Connecting to any of these endpoints subscribes the connection to channel `"test"`.

On the local testing environment, data can be sent to the connections via the GRIP publish endpoint at `http://localhost:5561/publish/`. For example, here's a curl command to send a WebSocket message:

```sh
curl \
  -d '{"items":[{"channel":"test","formats":{"ws-message":{"content":"hello"}}}]}' \
  http://localhost:5561/publish/
```

Once deployed to your Fastly service, the GRIP publish endpoint is at `https://api.fastly.com/service/{service-id}/publish/`. Here's the same example on Fastly service:

```sh
curl \
  -H "Authorization: Bearer {fastly-api-token}" \
  -d '{"items":[{"channel":"test","formats":{"ws-message":{"content":"hello"}}}]}' \
  https://api.fastly.com/service/{service-id}/publish/
```

## How it works

Non-test requests are simply forwarded through the Fanout proxy and on to the origin.

For test requests, the app is actually invoked twice.

1. Initially, a client request arrives at the app without having been routed through the Fanout proxy yet. The app checks for this via the presence of a `Grip-Sig` header. If that header is not present, the app calls `req.handoff_fanout("self")` and exits. This tells the subsystem that the connection should be routed through Fanout, and is used for HTTP requests controlled by GRIP.

2. Since `self` refers to the same app, a second request is made to the same app, this time coming through Fanout. The app checks for this, and then handles the request accordingly (in `handle_test()`).

## Compatibility

- [Fastly CLI](https://www.fastly.com/documentation/reference/tools/cli/) 15.2.0 or newer
- [Fastly Local Development Server (Viceroy)](https://www.fastly.com/documentation/guides/compute/developer-guides/testing/#running-a-local-testing-server) 0.18.0 or newer

## Security issues

Please see [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.

