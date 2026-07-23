# Compute Starter Kit for JavaScript: esbuild

[![Deploy to Fastly](https://deploy.edgecompute.app/button)](https://deploy.edgecompute.app/fastly/compute-starter-kit-javascript-esbuild)

Learn how to use [esbuild](https://esbuild.github.io) to bundle modules for the [Fastly Compute JavaScript environment](https://www.fastly.com/documentation/guides/compute/javascript/).

**For more details about other starter kits for Compute, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters)**

## Features

* Contains build steps configured to bundle your application using [esbuild](https://esbuild.github.io).
* Provides a starting point for an esbuild configuration for use with Fastly Compute.
* Demonstrates transpiling [JSX syntax](https://facebook.github.io/jsx/) to JavaScript during bundling.

The example source code is a JSX file and holds dependencies on `react` and `react-dom/server.edge` (this is a build of `react-dom/server` designed for edge runtimes such as Fastly Compute). It demonstrates serialization of a React component into a stream, served as a synthesized response from a Compute application.

```jsx
import * as React from 'react';
import * as Server from 'react-dom/server.edge';

const Greet = () => <h1>Hello, world!</h1>;
return new Response(
  await Server.renderToReadableStream(<Greet />),
  {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
    },
  },
);
```

## Understanding the code

Compute applications written in JavaScript that have the [standard structure](https://www.fastly.com/documentation/guides/compute/javascript/#project-layout) and [standard dependencies](https://www.fastly.com/documentation/guides/compute/javascript/#using-dependencies) can be built using the tools included with the JavaScript SDK. However, if your application needs to perform advanced tasks at build time, such as replacing global modules, providing polyfills, or transforming code (such as JSX, TypeScript, or proposed JavaScript syntaxes), you can use a module bundler.

This starter kit demonstrates the use of esbuild for bundling, providing a configuration as a `esbuild.config.js` file that can be used as a starting point for configuring your application's specific bundling needs.

The esbuild package is declared as a dependency and run in a `prebuild` script, configured to place its output in an intermediate location. The `build` script then references those intermediate files as its input.

### The `esbuild.config.js` file

The esbuild package does not mandate a filename for configuration. Instead, esbuild is called via either a CLI or JavaScript API. This starter kit includes an `esbuild.config.js` file, which stores the configuration and calls `esbuild`.

At minimum, the configuration to bundle a Compute application for `esbuild` should include the following (pre-configured for this project):
* `entryPoints` - The entry point source files provided as an array, `['./src/index.jsx']` in this app.
* `bundle` - Set to `true`. Tells esbuild to run in bundle mode, in other words, to inline the dependency modules into the output file.
* `platform` - Set to `neutral` - Tells esbuild to use [neutral defaults](https://esbuild.github.io/api/#platform).
* `outfile` - Tells esbuild where to place the output bundled file, `./dist/index.js` in this app.
* `external` - Set to `[ 'fastly:*', ]`. Indicates to esbuild that `fastly:` imports should be looked up as external imports rather than modules under `node_modules`.
* `conditions` - Set to `['fastly']`.

```javascript
import { build } from 'esbuild';

await build({
  entryPoints: ['./src/index.jsx'],
  bundle: true,
  platform: 'neutral',
  outfile: './dist/index.js',
  external: [ 'fastly:*' ],
  conditions: [ 'fastly' ],
});
```

Using these as a starting point, you can further customize the configuration to meet your needs. For example:
- [`loader`](https://esbuild.github.io/api/#loader) - can be used to determine how input files will be treated.
- [`alias`](https://esbuild.github.io/api/#alias) - can be used to replace modules at build time.
- [`plugins`](https://esbuild.github.io/plugins/) - can be used to include [plugins](https://esbuild.github.io/plugins/), which are modules that can inject code at variout points in time during bundling.
- Refer to the [esbuild Build options](https://esbuild.github.io/api/#build) for more details.

> [!TIP]
> See the Fastly Documentation section on [module bundling for JavaScript](https://www.fastly.com/documentation/guides/compute/javascript/#module-bundling) for further hints.

### The build process

The `package.json` file of this application includes the following scripts:
```json5
{
  "scripts": {
    "prebuild": "node esbuild.config.js",
    "build": "js-compute-runtime ./dist/index.js ./bin/main.wasm",
    // other scripts
  }
}
```

Building the application through `fastly compute build` (or indirectly by calling `fastly compute serve` or `fastly compute publish`) causes the following steps to run:

1. The `fastly.toml` file is consulted for its `scripts.build` value, resulting in `npm run build`. This instructs npm to execute the `build` script.
2. Because `package.json` defines a `prebuild` script, npm first runs it: `node esbuild.config.js` runs, using esbuild to bundle `src/index.jsx` and its imports into a single JS file, `./dist/index.js`.
3. npm runs the `build` script: The `js-compute-runtime` CLI tool (included as part of the `@fastly/js-compute` package) wraps the bundled JS file into a Wasm file at `bin/main.wasm` and packages it into a `.tar.gz` file ready for deployment to Compute.

#### Transpiling JSX using esbuild

By default, esbuild automatically applies the JSX loader for files with the `.jsx` extension, and transpiles JSX syntax to JavaScript during bundling. To exercise fine control over any options during this transformation, refer to the [JSX loader](https://esbuild.github.io/content-types/#jsx) reference in esbuild documentation.

### Package type

The starter kit's `package.json` file sets [`"type": "module"`](https://nodejs.org/api/packages.html#type). This ensures `.js` source files are loaded as [ES modules](https://nodejs.org/api/esm.html), enabling them to use the modern `import` and `export` syntax to interact with other modules and packages.

### Conditional exports

The starter kit is configured to use the condition names `fastly` when resolving modules ([`conditions`](https://esbuild.github.io/api/#conditions)). These are taken into consideration during the bundling process when esbuild encounters a package that [defines conditional exports](https://nodejs.org/api/packages.html#conditional-exports).

## Running the application

To create an application using this starter kit, create a new directory for your application and switch to it, and then type the following command:

```shell
npm create @fastly/compute@latest -- --from=https://github.com/fastly/compute-starter-kit-javascript-esbuild
```

To build and run your new application in the local development environment, type the following command:

```shell
npm run start
```

To build and deploy your application to your Fastly account, type the following command. The first time you deploy the application, you will be prompted to create a new service in your account.

```shell
npm run deploy
```

By default, esbuild pretty-prints the output bundle. In order to make the bundle smaller, the starter kit adds the [`minify` configuration value](https://esbuild.github.io/api/#minify) when the bundle is built for production. To build in production mode, set the `NODE_ENV` environment variable to `'production'` when building the bundle.

For example:
```shell
NODE_ENV=production npm run start
```

The starter kit doesn't require the use of any backends. Once deployed, you will have a Fastly service running on Compute that can generate synthetic responses at the edge.

## Next steps

This starter kit is configured to use additional packages to demonstrate the transpilation of JSX to JavaScript, and the use of React to render it to HTML.

If your application does not need React or JSX, you may remove this functionality using the following steps:
1. Rename the `index.jsx` file to `index.js`, and remove all code that uses the JSX syntax or that refers to the `react` and `react-dom` packages.
2. In `esbuild.config.js`, modify the `entryFiles` field from `['./src/index.jsx']` to `['./src/index.js']` to reflect this file name change.
3. Remove the following dependencies from your application:
   ```shell
   npm uninstall react react-dom
   ```

JSX is just one of the loaders provided by esbuild. Many others are provided by esbuild as well, to make various types of files available for loading as modules in your application. These can be mixed and matched, allowing your application to load anything it needs, including [JSON files](https://esbuild.github.io/content-types/#json), [CSS files](https://esbuild.github.io/content-types/#css), and raw files as [text](https://esbuild.github.io/content-types/#text) or [binary](https://esbuild.github.io/content-types/#binary). See [esbuild loaders](https://esbuild.github.io/content-types/) for a list of loaders.

If you need to load shims or polyfills to make functionality available to your Compute application, take a look at the [`inject` option](https://esbuild.github.io/api/#inject) in the esbuild documentation.

If you need to redirect or alter rules related to module resolution, take a look at the [Path Resolution guide](https://esbuild.github.io/api/#path-resolution) in the esbuild documentation.

The esbuild bundler has many configuration options, but is designed in such a way that many of the defaults are sensible, so you only need to make changes that your application needs. Refer to [the Build API guide](https://esbuild.github.io/api/#build) in the esbuild documentation for further details.

## Security issues

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
