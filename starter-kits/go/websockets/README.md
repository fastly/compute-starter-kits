# Fastly Compute WebSockets starter kit for Go

Learn about Fastly Compute with WebSockets using a basic starter that sends connections to a backend.

Note: The WebSockets feature handles passthrough connections only. If you want to handle WebSocket connections from clients without having to run a WebSocket backend, see the [Fanout Starter Kit](https://github.com/fastly/compute-starter-kit-go-fanout).

**For more details about this and other starter kits for Compute, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters/)**.

## Setup

The app expects a configured backend named `backend` that points to a WebSocket server. For example, if the WebSocket server is available at domain `websockets.example.com`, then you'll need to create a backend on your Compute service named `backend` with the destination host set to `websockets.example.com` and port 443. Also set 'Override Host' to the same host value.

After deploying the app and setting up the backend configuration, all connections received by the service will be passed to the backend.

### Enabling WebSockets passthrough

When you create a new service from this starter kit, WebSockets passthrough is enabled automatically.

To [enable WebSockets passthrough](https://www.fastly.com/documentation/guides/concepts/real-time-messaging/websockets-tunnel/#enabling-websockets-passthrough) on an existing Fastly service, type:

```shell
fastly products --enable=websockets
```

## Testing locally

If testing locally, make sure that you have a backend named `backend` defined in the `local_server` section of your `fastly.toml` file:

```toml
[local_server.backends]
[local_server.backends.backend]
url = "https://websockets.example.com/"
override_host = "websockets.example.com"
```

## Compatibility

- [Fastly CLI](https://www.fastly.com/documentation/reference/tools/cli/) 15.2.0 or newer
- [Fastly Local Development Server (Viceroy)](https://www.fastly.com/documentation/guides/compute/developer-guides/testing/#running-a-local-testing-server) 0.18.0 or newer

## Security issues

Please see [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
