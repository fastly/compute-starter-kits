# Hono Starter Kit for TypeScript on Fastly Compute

Get to know [Hono](https://hono.dev) on the [Fastly Compute](https://www.fastly.com/products/edge-compute) environment with a basic starter written in TypeScript.

This starter demonstrates how to:

- Define [typed environment bindings](https://github.com/fastly/compute-js-context?tab=readme-ov-file#typed-bindings-with-buildcontextproxy) (`Backend`, `Logger`, etc.)
- Add routing and middleware with Hono
- Build synthetic responses at the edge
- Forward requests to backends with caching overrides
- Serve static files compiled directly into your Compute app

> For more starter kits and patterns, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters).

## Features

- TypeScript source with `tsconfig.json` pre-configured for Compute
- Usage of the [`@fastly/hono-fastly-compute`](https://www.npmjs.com/package/@fastly/hono-fastly-compute) helper library
- Restrict allowed HTTP methods
- Route matching with Hono
- Static file embedding via `includeBytes`
- Logging to a Fastly endpoint
- Backend fetch with `CacheOverride`

## Code Walkthrough

The entry point `src/index.ts` includes several common patterns you'll use when building Compute apps with Hono:

- **Defining environment context bindings**
  ```ts
  const fire = buildFire({
    httpme: 'Backend:http-me',        // I have a backend named `http-me`
    myEndpoint: 'Logger:my_endpoint', // I have a logging endpoint named `my_endpoint`
  });
  type Env = {
    Bindings: typeof fire.Bindings,
  };
  const app = new Hono<Env>();

  // set up routes...

  fire(app);
  ```
  
  Defined environment resources are available on `c.env` within handlers and middleware [(env on Hono)](https://hono.dev/docs/api/context#env), for example:

  ```ts
  c.env.myEndpoint.log('Hello from the edge!');
  ```

  For more details on context bindings, see [@fastly/compute-js-context (typed environment bindings)](https://github.com/fastly/compute-js-context?tab=readme-ov-file#typed-bindings-with-buildcontextproxy).

- **Static file response**
  ```ts
  const welcomePage = includeBytes('./src/welcome-to-compute.html');
  return c.body(welcomePage, 200, { 'Content-Type': 'text/html' });
  ```

- **Streaming log endpoint**
  ```ts
  c.env.myEndpoint.log('Hello from the edge!');
  ```

- **Method filtering**
  ```ts
  app.use(createMiddleware(async (c, next) => {
    if (!["HEAD", "GET", "PURGE"].includes(c.req.method)) {
      return c.text("This method is not allowed", 405);
    }
    await next();
  }));
  ```

- **Backend fetch with cache override**
  ```ts
  const cacheOverride = new CacheOverride('override', { ttl: 60 });
  const beresp = await fetch(bereq, { backend: c.env.httpme, cacheOverride });
  ```

## Getting Started

Create a new app from this starter kit:

```bash
npm create @fastly/compute@latest -- --language=typescript --starter-kit=hono
```

Run locally with the [local development environment](https://www.fastly.com/documentation/guides/compute/developer-guides/testing/#running-a-local-testing-server):

```bash
npm run start
```

Deploy to Fastly (you'll be prompted to create a new service if you don't have one yet):

```bash
npm run deploy
```

## Next Steps

- Try adding a new route in `index.ts`, e.g. `app.get('/hello', ...)`
- Configure a real backend in `fastly.toml` and call it from your code
- Explore [`@fastly/compute-js-context`](https://github.com/fastly/compute-js-context) for richer typed bindings
- Add middleware from the [Hono ecosystem](https://hono.dev/middleware)

## Security

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
