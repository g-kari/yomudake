import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose';

const MAX_TOKEN_LENGTH = 16_384;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TEAM_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function readConfiguration(env) {
  if (
    !nonemptyString(env?.ACCESS_TEAM_DOMAIN) ||
    !nonemptyString(env?.ACCESS_AUD) ||
    !nonemptyString(env?.OWNER_EMAIL) ||
    /\s/.test(env.ACCESS_AUD) ||
    !/^[^\s@]+@[^\s@]+$/.test(env.OWNER_EMAIL)
  ) {
    return null;
  }

  try {
    const team = new URL(env.ACCESS_TEAM_DOMAIN);
    if (
      team.protocol !== 'https:' ||
      !TEAM_HOST_PATTERN.test(team.hostname) ||
      team.username ||
      team.password ||
      team.port ||
      team.pathname !== '/' ||
      team.search ||
      team.hash ||
      // Require a canonical origin (with an optional trailing slash). This also
      // rejects URL-parser normalization tricks and explicit default ports.
      ![team.origin, `${team.origin}/`].includes(env.ACCESS_TEAM_DOMAIN)
    ) {
      return null;
    }
    return {
      issuer: team.origin,
      audience: env.ACCESS_AUD,
      ownerEmail: env.OWNER_EMAIL,
    };
  } catch {
    return null;
  }
}

function unauthorized() {
  // Do not disclose token contents, verification details, or the owner's email.
  return { ok: false, status: 401, error: 'Owner authentication required.' };
}

/**
 * Verify an owner request using a Cloudflare Access application JWT.
 *
 * The only accepted identity source is the signed Cf-Access-Jwt-Assertion.
 * ACCESS_TEAM_DOMAIN must be an HTTPS Cloudflare Access team origin;
 * ACCESS_AUD is the exact application AUD tag; OWNER_EMAIL is the expected
 * signed email, compared exactly. Missing configuration always fails closed.
 *
 * The optional fetch/JWKS injections are for trusted application code and
 * offline tests only. Never populate them from request headers or token data.
 * A JWKS injection accepts either a jose key resolver or a JSON Web Key Set.
 */
export function createAccessGuard({ fetch: fetchImplementation, jwks } = {}) {
  const injectedKeys = jwks
    ? typeof jwks === 'function'
      ? jwks
      : createLocalJWKSet(jwks)
    : undefined;
  // Only public verification keys are cached, never request identities/tokens.
  let cachedIssuer;
  let cachedKeys;

  function trustedKeys(issuer) {
    if (injectedKeys) return injectedKeys;
    if (cachedIssuer !== issuer) {
      const options = { timeoutDuration: 5_000 };
      if (fetchImplementation) options[customFetch] = fetchImplementation;
      cachedKeys = createRemoteJWKSet(
        new URL('/cdn-cgi/access/certs', issuer),
        options,
      );
      cachedIssuer = issuer;
    }
    return cachedKeys;
  }

  return async function guard(request, env) {
    const config = readConfiguration(env);
    if (!config) {
      return {
        ok: false,
        status: 503,
        error: 'Owner authentication is not configured.',
      };
    }

    const token = request?.headers?.get('cf-access-jwt-assertion');
    if (
      typeof token !== 'string' ||
      token.length > MAX_TOKEN_LENGTH ||
      !TOKEN_PATTERN.test(token)
    ) {
      return unauthorized();
    }

    try {
      const header = decodeProtectedHeader(token);
      if (
        header.alg !== 'RS256' ||
        !nonemptyString(header.kid) ||
        // Token-provided key material/locations are never a trust source.
        ['jku', 'jwk', 'x5u', 'x5c'].some((name) => Object.hasOwn(header, name))
      ) {
        return unauthorized();
      }

      const { payload } = await jwtVerify(token, trustedKeys(config.issuer), {
        algorithms: ['RS256'],
        issuer: config.issuer,
        audience: config.audience,
        requiredClaims: ['exp', 'sub', 'email'],
        clockTolerance: 0,
      });

      // jwtVerify validates exp and any nbf, as well as iss/aud. Identity is
      // deliberately taken only after successful signature/claim verification.
      if (
        !nonemptyString(payload.sub) ||
        !nonemptyString(payload.email)
      ) {
        return unauthorized();
      }
      if (payload.email !== config.ownerEmail) {
        return { ok: false, status: 403, error: 'Owner access required.' };
      }
      return {
        ok: true,
        status: 200,
        identity: { sub: payload.sub, email: payload.email },
      };
    } catch {
      // Malformed tokens, unknown keys, network failures and invalid claims all
      // deny access. The caller must not proceed when ok is false.
      return unauthorized();
    }
  };
}

export const verifyOwnerRequest = createAccessGuard();
export default verifyOwnerRequest;
