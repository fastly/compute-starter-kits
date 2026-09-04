/// <reference types="@fastly/js-compute" />
import { ConfigStore } from 'fastly:config-store'
import { SecretStore } from 'fastly:secret-store'

const CONFIG_STORE_NAME = `oauth_config`

// Secrets are loaded from a Fastly Secret Store.
// See: https://www.fastly.com/documentation/guides/concepts/edge-state/dynamic-config/#secret-stores
const SECRET_STORE_NAME = `oauth_secrets`

const loadServiceConfig = async () => ({
  // OAuth 2.0 client identifier valid at the authorization server.
  clientId: await getSecret('client_id'),

  // Client secret, if the IdP requires one.
  // WARNING: Including this parameter produces NON-NORMATIVE OAuth 2.0 token requests: https://openid.net/specs/openid-connect-core-1_0.html#rfc.section.3.1.3.1
  clientSecret: await getSecret('client_secret'),

  // Whether to verify the access token using the IdP's userinfo endpoint (rather than at the edge). If token revocation is not a concern – or when IdP rate limits are – set this to false.
  introspectAccessToken: false,

  // Whether the access token is a JWT. Relevant only when introspectAccessToken = false. JWT access tokens can be validated at the edge.
  jwtAccessToken: false,

  // Path for the redirection URI to which OAuth 2.0 responses will be sent.
  callbackPath: '/callback',

  // PKCE code challenge method (https://tools.ietf.org/html/rfc7636#section-4.3).
  codeChallengeMethod: 'S256',

  // Length of an arbitrary alphanumeric suffix added to the parameter used to maintain state between the request and the callback.
  stateParameterLength: 10,

  // OAuth 2.0 scope list (one or more space-separated scopes).
  scope: 'openid',

  // A secret to verify the OpenID nonce used to mitigate replay attacks. It must be sufficiently random to not be guessable.
  nonceSecret: new TextEncoder().encode(await getSecret('nonce_secret'))
})

const loadJsonFromConfigStore = key => {
  const store = new ConfigStore(CONFIG_STORE_NAME)
  const data = JSON.parse(store.get(key))
  if (!data) {
    throw new Error(`Failed to retrieve ${key} from Config Store.`)
  }
  return data
}

export const getSecret = async key => {
  const secrets = new SecretStore(SECRET_STORE_NAME)
  const secret = await secrets.get(key)
  return secret?.plaintext()
}

export const loadConfig = async () => ({
  config: await loadServiceConfig(),
  jwks: loadJsonFromConfigStore('jwks'),
  openidConfiguration: loadJsonFromConfigStore('openid_configuration')
})
