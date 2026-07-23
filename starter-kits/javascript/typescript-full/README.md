# Starter Kit For Full TypeScript

Get to know the Fastly Compute environment with a basic starter that demonstrates the use of the TypeScript compiler `tsc`.

The functionality of the starter kit is the same as the [Default TypeScript starter kit](https://github.com/fastly/compute-starter-kit-typescript-default).

**For more details about other starter kits for Compute, see the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters)**

## Features
* Implements a `prebuild` script that calls the TypeScript compiler `tsc` to transpile to JavaScript. 

## Understanding the code

This starter requires no dependencies aside from [`@fastly/js-compute`](https://www.npmjs.com/package/@fastly/js-compute) and [`typescript`](https://www.npmjs.com/package/typescript). It works by calling `tsc` from the `prebuild` script in `package.json`.

The template uses TypeScript to compile source files in `./src` into JS files in `./build`, which are then wrapped into `./bin/index.wasm` using the `js-compute-runtime` CLI tool bundled with the `@fastly/js-compute` npm package, and bundled into a `.tar.gz` file ready for deployment to Compute.

The SDK includes a `tsconfig.json` file to configure the TypeScript compiler, as well as to aid your IDE in coding support.

## Running the application

To create an application using this starter kit, create a new directory for your application and switch to it, and then type the following command:

```shell
npm create @fastly/compute@latest -- --language=typescript --starter-kit=full
```

To build and run your new application in the local development environment, type the following command:

```shell
npm run start
```

To build and deploy your application to your Fastly account, type the following command. The first time you deploy the application, you will be prompted to create a new service in your account.

```shell
npm run deploy
```

## Security issues

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
