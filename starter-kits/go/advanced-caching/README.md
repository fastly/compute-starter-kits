# Advanced Caching Starter Kit for Go

Get to know [advanced caching with Fastly Compute](https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#customizing-cache-interaction-with-the-backend) for Go with a starter kit.

**For more details about this and other starter kits for Compute, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters/)**.

## What's this?

As of [version 1.4.0](https://www.fastly.com/documentation/reference/changes/2025/04/go-sdk-1.4.0/) of the Fastly Compute SDK for Go, it is now possible to apply advanced caching techniques while accessing the [Fastly readthrough cache](https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#readthrough-cache).

- Modifying a request as it is forwarded to a backend
- Controlling cache behavior based on backend response
- Manipulating the response body that is stored to the cache

This starter kit gives you a starting point for calling these extension points, enabling you to understand and customize powerful caching behavior with Fastly Compute.

> [!NOTE]
> The advanced caching features whose uses are illustrated in this starter kit are not currently supported in Fastly's [local development server](https://www.fastly.com/documentation/guides/compute/testing/#running-a-local-testing-server). Attempting to run this starter kit in the local development server may result in the following error:
> ```
> HTTP caching API is not enabled.
> ```

## Understanding the code

Because advanced caching requirements vary significantly between applications, this starter kit is not designed to be deployed and run directly out of the box, unlike most Fastly Compute starter kits. Rather, it is a starting point for a Fastly Compute application code that shows how to set up the advanced caching features of the readthrough cache:

- the [before-send](https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#modifying-a-request-as-it-is-forwarded-to-a-backend) callback function
- the [after-send](https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#controlling-cache-behavior-based-on-backend-response) callback function
- the [body-transform](https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#modifying-the-body-that-is-saved-to-the-cache) callback function

Since the code of this starter kit works with the Fastly readthrough cache, it expects a configured backend named "origin" that points to an origin server. For example, if the server is available at domain `example.com`, then you'll need to create a backend on your Compute service named "origin" with the destination host set to `example.com` and port `443`. Also set `Override Host` to the same host value.

For details on advanced caching, see [Customizing cache interaction with the backend](https://www.fastly.com/documentation/guides/concepts/edge-state/cache/#customizing-cache-interaction-with-the-backend) in the developer documentation.

## Security issues

Please see [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
