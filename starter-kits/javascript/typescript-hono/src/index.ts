import { CacheOverride } from 'fastly:cache-override';
import { includeBytes } from 'fastly:experimental';
import { buildFire, logFastlyServiceVersion } from '@fastly/hono-fastly-compute';
import { createMiddleware } from 'hono/factory';
import { Hono } from 'hono/quick';

// Load a static file (relative to root of project) as a Uint8Array at compile time.
const welcomePage = includeBytes('./src/welcome-to-compute.html');

// Define context bindings and build fire() function
const fire = buildFire({
  httpme: 'Backend:http-me',
  myEndpoint: 'Logger:my_endpoint',
});

// Define Hono environment using context bindings
type Env = {
  Bindings: typeof fire.Bindings,
};
const app = new Hono<Env>();

// Log service version
app.use(logFastlyServiceVersion());

// Filter requests that have unexpected methods
app.use(createMiddleware(async (c, next) => {
  if (!["HEAD", "GET", "PURGE"].includes(c.req.method)) {
    return c.text("This method is not allowed", 405);
  }
  await next();
}));

// Below are some common patterns for Fastly Compute services using JavaScript/TypeScript.
// Head to https://developer.fastly.com/learning/compute/javascript/ to discover more.

app.get('/', async (c) => {

  // Log to a Fastly endpoint.
  c.env.myEndpoint.log('Hello from the edge!');

  // Return HTML content
  return c.body(welcomePage as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'text/html; charset=utf-8' });

});

app.get('/info', async (c) => {

  // Create a new request to a backend
  const bereq = new Request('https://http-me.fastly.dev/anything');

  // Add request headers.
  bereq.headers.set('X-Custom-Header', 'Welcome to Fastly Compute!');
  bereq.headers.set(
    'X-Another-Custom-Header',
    'Recommended reading: https://www.fastly.com/documentation/guides/compute/'
  );

  // Create a cache override.
  // To use this, uncomment the import statement at the top of this file for CacheOverride.
  const cacheOverride = new CacheOverride('override', { ttl: 60 });

  // Forward the request to a backend.
  const beresp = await fetch(bereq, {
    backend: c.env.httpme,
    cacheOverride,
  });

  // Remove response headers.
  beresp.headers.delete('X-Served-by');

  return beresp;

});

app.use(async (c) => c.text('The page you requested could not be found', 404));

fire(app);
