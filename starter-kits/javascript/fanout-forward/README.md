# Fanout forward Compute starter kit for JavaScript

Learn about [Fastly Compute with Fanout](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/) using a basic starter that sends connections through the Fanout GRIP proxy to a backend.

**For more details about this and other starter kits for Compute, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters/)**.

## Local testing

To test Fanout features in the local testing environment, first obtain [Pushpin](https://pushpin.org), the open-source GRIP proxy server that Fastly Fanout is based upon, and make sure it is available on the system path.

Create a Fastly Compute project based on this starter kit.

```term
mkdir my-fanout-project
cd my-fanout-project
npm create @fastly/compute@latest -- --language=javascript --starter-kit=fanout-forward
```

The `fastly.toml` file included in this starter kit includes a `local_server.pushpin` section:
```toml
[local_server.pushpin]
enable = true
```

It also sets the backend named `"origin"` to `localhost:3000`.

Run the starter kit:
```term
fastly compute serve
```

The Fastly CLI starts Pushpin and then starts the starter kit app at http://localhost:7676/.

On the local testing environment, data can be sent to the connections via the GRIP publish endpoint at `http://localhost:5561/publish/`.

> **IMPORTANT:** Specifying remote backends when testing Fanout handoff in the local development environment is valid. However, because the publishing API runs locally, it is often convenient to also locally run any backends or applications that need to test publishing.

## Running the application on Fastly

The app expects a configured backend named "origin" that points to an origin server. For example, if the server is available at domain `example.com`, then you'll need to create a backend on your Compute service named "origin" with the destination host set to `example.com` and port `443`. Also set `Override Host` to the same host value.

### Enabling Fanout

When you create a new service from this starter kit, Fanout is enabled automatically.

To [enable Fanout](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/#enable-fanout) on an existing Fastly service, type:

```shell
fastly products --enable=fanout
```

### Handling requests

After setting up the backend configuration and enabling Fanout, incoming HTTP and WebSocket requests that arrive at the service will be processed by the fetch handler:

   1. WebSocket connections will be handed off to Fanout to reach the backend server. Fanout maintains a long-lived connection with the client, and uses the [WebSocket-over-HTTP protocol](https://pushpin.org/docs/protocols/websocket-over-http/) to transform the messages to and from the backend server.

   2. HTTP GET and HEAD requests will be handed off to Fanout to reach the backend server. The backend can include [GRIP control messages](https://pushpin.org/docs/protocols/grip/) in its response, instructing Fanout to maintain a long-lived connection with the client.

The GRIP publish endpoint is at `https://api.fastly.com/service/{service-id}/publish/`.

## Next Steps

The starter kit is written to send hand off all WebSocket and HTTP GET (and HEAD) traffic through Fanout. In an actual app we would be selective about which requests are handed off through Fanout, because requests that are handed off through Fanout do not pass through the Fastly cache.

For details, see [What to hand off to Fanout](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/fanout/#what-to-hand-off-to-fanout) in the Developer Documentation.

The starter kit code contains a TODO section where you may insert additional conditions to check before setting the `useFanout` variable to `true`.

For example, to check the request for the existence of a certain header:

```javascript
  if (request.headers.has('fanout')) {
    useFanout = true;
  }
```

## Compatibility

- [Fastly CLI](https://www.fastly.com/documentation/reference/tools/cli/) 15.2.0 or newer
- [Fastly Local Development Server (Viceroy)](https://www.fastly.com/documentation/guides/compute/developer-guides/testing/#running-a-local-testing-server) 0.18.0 or newer

## Security issues

Please see [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
