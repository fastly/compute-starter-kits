# OAuth 2.0 JavaScript application starter kit for Fastly Compute

Connect to an identity provider such as Okta using OAuth 2.0 and validate authentication status at the network's edge, using [Fastly Compute](https://www.fastly.com/products/edge-compute) to authorize access to your edge or origin hosted applications.

**For more starter kits for Compute, head over to the [Fastly Documentation Hub](https://www.fastly.com/documentation/solutions/starters)**

> This starter kit has an [equivalent Rust implementation](https://github.com/fastly/compute-starter-kits/tree/main/starter-kits/rust/auth) 🦀

## Authentication at the network's edge, using OAuth 2.0, OpenID Connect, and Fastly Compute

This is a self-contained JavaScript implementation for the [OAuth 2.0](https://oauth.net/2/) [Authorization Code flow](https://oauth.net/2/grant-types/authorization-code/) with [Proof Key for Code Exchange (PKCE)](https://oauth.net/2/pkce/), deployed to [Fastly Compute](https://www.fastly.com/products/edge-compute/).

It includes [JSON Web Token (JWT)](https://oauth.net/2/jwt/) verification, and [access token introspection](https://oauth.net/2/token-introspection/).

![A simplified flow diagram of authentication using Compute](https://user-images.githubusercontent.com/12828487/111877689-4b876500-899c-11eb-9d6c-6ecc240fa317.png)

Scroll down to view [the flow in more detail](#the-flow-in-detail).

## Getting started

After you have installed the starter kit, you'll need to do some configuration before you can deploy it, so that Fastly knows which identity provider to use and how to authenticate.

> Make sure you have installed and configured the [Fastly CLI](https://www.fastly.com/documentation/reference/tools/cli) first.

### Quick start

1. Obtain a client ID and optional client secret from your chosen OAuth 2.0 Identity Provider (IdP).
1. Run `fastly compute publish` and follow the interactive configuration prompts to set up a new Fastly Compute service. You'll be prompted for your [configuration secrets](#configuration-secrets) and [configuration data](#configuration-data) along the way.
1. Add `https://{your-fastly-compute-domain}/callback` to the list of allowed callback URLs in your IdP's app configuration.

### Configuration

The first time you run `fastly compute publish`, respond with `y` to the prompt to create a new service. 

Accepting the default values for all other prompts will set up [Google](https://developers.google.com/identity/protocols/oauth2) as your OAuth 2.0 Identity Provider (IdP), to let you get started as quickly as possible. You may choose to provide your own configuration settings instead.

```term
Create new service: [y/N] y

Service name: [my-oauth-app] 

✓ Creating service

Domain: [vaguely-pretty-ray.edgecompute.app] 

Configure a backend called 'origin'
...
```

#### Backends

You will be prompted to set up two backends:
* `idp`: Your authorization server;
* `origin`: Your application or content server.

#### Configuration data
Configuration data lives in Fastly [Config Store](https://www.fastly.com/documentation/guides/concepts/edge-state/dynamic-config/#config-stores) named `oauth_config`, with the following keys:
* `openid_configuration`: The OpenID Configuration (OIDC) metadata from your authorization server, JSON-serialized;
* `jwks`: JWKS metadata from your authorization server (obtained from the `jwks_uri` property of the OIDC metadata), JSON-serialized.

> 💡 After you've obtained each of the JSON metadata above from your authorization server, you'll have to **stringify** it before using as an input for the Fastly CLI. Check out this [jq playground snippet](https://jqplay.org/s/10cbMJ-5nAw) for a quick way to accomplish this.

#### Configuration secrets

Configuration secrets live in a Fastly [Secret Store](https://www.fastly.com/documentation/guides/concepts/edge-state/dynamic-config/#secret-stores) named `oauth_secrets`, with the following keys:
* `client_id`: The OAuth 2.0 client ID (determined by the Identity Provider (IdP)).
* `client_secret`: The OAuth 2.0 client secret (if required by the IdP).
* `nonce_secret`: A secret to verify the OpenID nonce used to mitigate replay attacks. It must be sufficiently random to not be guessable.

`fastly compute publish` creates the store and prompts you for each of these values, as declared under `[setup.secret_stores]` in `fastly.toml`.

> 💡 Run `dd if=/dev/random bs=32 count=1 | base64` to generate a random, non-guessable secret.

For [local development](#local-development), the same three values are read from files in the root of your project, as declared under `[local_server.secret_stores]` in `fastly.toml`: `.secret.client_id`, `.secret.client_secret`, and `.secret.nonce_secret`. These files are gitignored, and excluded from the published package by `.fastlyignore`.

## Using an OAuth 2.0 Identity Provider with Fastly Compute

### 1. Set up an Identity Provider (IdP)

You might operate your own identity service, but any [OAuth 2.0, OpenID Connect (OIDC) conformant identity provider](https://en.wikipedia.org/wiki/List_of_OAuth_providers) will work.  You will need the following from your IdP:

* A *Client ID*, and optionally, a *Client secret* ➡️ Set the `client_id` and `client_secret` keys in the [Secret Store](https://www.fastly.com/documentation/guides/concepts/edge-state/dynamic-config/#secret-stores).
* An *OpenID Connect Discovery document* ➡️ Set the `openid_configuration` key (JSON-serialized string value) in the [Config Store](https://www.fastly.com/documentation/guides/concepts/edge-state/dynamic-config/#config-stores).
* A *JSON Web key set* ➡️  Set the `jwks` key (JSON-serialized string value) in the [Config Store](https://www.fastly.com/documentation/guides/concepts/edge-state/dynamic-config/#config-stores).
* The hostname of the IdP's *authorization server* ➡️ Create as a backend called `idp` on your Fastly service

### 2. Deploy the Fastly service and get a domain

To build and deploy your Fastly Compute service, run:

```term
fastly compute publish
```

You'll be prompted to enter a series of configuration settings, [explained above](#configuration). When the deployment is finished you'll be given a Fastly-assigned domain such as `random-funky-words.edgecompute.app`.

### 3. Link the Identity Provider to your Fastly domain

Remember to add `https://{your-fastly-compute-domain}/callback` (e.g., _https://{random-funky-words}.edgecompute.app/callback_) to the list of allowed callback URLs in your IdP's OAuth app configuration.

This allows the authorization server to send the user back to the Compute@Edge service.

### Example

As an example, if you are using [Google](https://developers.google.com/identity/protocols/oauth2) as your IdP, follow these steps:

1. In the [Google API Console](https://console.developers.google.com/), use the **Credentials API** to create a [new OAuth client ID](https://console.cloud.google.com/apis/credentials/oauthclient). Choose **Web application** as your application type, give your app a name, and finally make note of the following two outputs:
   - The *Client ID* (eg. `RANDOM_LONG_ID.apps.googleusercontent.com`) is shown next to your application name.
   - The *Client SECRET* (eg. `RANDOM_LONG_SECRET`) is shown next to your application name.
1. In the root of your Fastly project, paste the *Client ID* into `.secret.client_id` and the *Client secret* into `.secret.client_secret`. Type a long, non-guessable random string of your choice into `.secret.nonce_secret`.
   ```sh
   dd if=/dev/random bs=32 count=1 | base64 > .secret.nonce_secret
   ```
1. After you've [configured](#configuration) and deployed your new Fastly Compute service, find your new OAuth client ID in the [Google API Console](https://console.cloud.google.com/apis/credentials), and add `https://{random-funky-words}.edgecompute.app/callback` to the list of **Authorized redirect URIs** 
   > 💡 Optionally, also add `http://127.0.0.1:7676/callback` as an authorized redirect URI for local development.

### Try it out!

Follow the steps above and visit your Fastly-assigned domain.  You should be prompted to follow a login flow with your IdP, and then after successfully authenticating, will see content delivered from your own origin.

---

## The flow in detail

Here is how the authentication process works:

![Edge authentication flow diagram](https://user-images.githubusercontent.com/12828487/115379253-4438be80-a1c9-11eb-81af-9470e324434a.png)

1. The user makes a request for a protected resource, but they have no session cookie.
1. At the edge, this service generates:
   * A unique and non-guessable `state` parameter, which encodes what the user was trying to do (e.g., load `/articles/kittens`).
   * A cryptographically random string called a `code_verifier`.
   * A `code_challenge`, derived from the `code_verifier`.
   * A time-limited token, authenticated using the `nonce_secret`, that encodes the `state` and a `nonce` (a unique value used to mitigate replay attacks).
1. The `state` and `code_verifier` are stored in session cookies.
1. The service builds an authorization URL and redirects the user to the **authorization server** operated by the IdP.
1. The user completes login formalities with the IdP directly.
1. The IdP will include an `authorization_code` and a `state` (which should match the time-limited token we created earlier) in a post-login callback to the edge.
1. The edge service authenticates the `state` token returned by the IdP, and verifies that the state cookie matches its subject claim.
1. Then, it connects directly to the IdP and exchanges the `authorization_code` (which is good for only one use) and `code_verifier` for **security tokens**:
   * An `access_token` – a key that represents the authorization to perform specific operations on behalf of the user)
   * An `id_token`, which contains the user's profile information.
1. The end-user is redirected to the original request URL (`/articles/kittens`), along with their security tokens stored in cookies.
1. When the user makes the redirected request (or subsequent requests accompanied by security tokens), the edge verifies the integrity, validity and claims for both tokens. If the tokens are still good, it proxies the request to your origin.

## Local development

Run `fastly compute serve --watch` (or `npm run dev`) to spin up a local development server and watch source files for changes.

The local server reads your secrets from the `.secret.*` files described under [configuration secrets](#configuration-secrets), so create those before starting it.

## Issues

If you encounter any bugs or unexpected behavior, please [file an issue][bug].

[bug]: https://github.com/fastly/compute-starter-kits/issues/new?labels=bug

### Security issues

Please see our [SECURITY.md](./SECURITY.md) for guidance on reporting security-related issues.
