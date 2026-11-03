#!/usr/bin/env bash

# Sourced by every *_test.sh (MAIR-428, MAIR-474, MAIR-680).
#
# Only Core_API signs session JWTs (MAIR-680): Core gets the run's Ed25519 key pair
# (JWT_PRIVATE_KEY + JWT_PUBLIC_KEY), the BFF only the public key and no JWT_SECRET, so it verifies
# the EdDSA tokens Core signs and refuses every HS256 token. Each run gets a fresh key pair (an
# exported JWT_PRIVATE_KEY + JWT_PUBLIC_KEY pair wins), and the tokens the runners need are signed
# here exactly like Core signs them (EdDSA, `kid` = RFC 7638 thumbprint of the public key, claims
# { sub, role, exp, iss, aud }). Nothing is committed: the repos are public, so a committed key or
# token would be valid anywhere it was reused.
#
# Exports JWT_PRIVATE_KEY (for the core-api service only), JWT_PUBLIC_KEY and ADMIN_JWT (`sub=1`,
# the Admin seeded by liquibase, valid 4 hours), and defines sign_jwt and sign_jwt_file. Needs
# openssl 3, and node for sign_jwt_file.

if [ -z "${JWT_PRIVATE_KEY:-}" ] || [ -z "${JWT_PUBLIC_KEY:-}" ]; then
    JWT_PRIVATE_KEY="$(openssl genpkey -algorithm ed25519 2>/dev/null)" || return 1
    JWT_PUBLIC_KEY="$(printf '%s\n' "$JWT_PRIVATE_KEY" | openssl pkey -pubout)" || return 1
fi
export JWT_PRIVATE_KEY JWT_PUBLIC_KEY

b64url() {
    openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# `kid` of the session tokens: RFC 7638 thumbprint of the Ed25519 public key (the last 32 bytes of
# its DER), computed like mairie360_api_lib does.
JWT_KID="$(printf '{"crv":"Ed25519","kty":"OKP","x":"%s"}' \
    "$(printf '%s\n' "$JWT_PUBLIC_KEY" | openssl pkey -pubin -outform DER | tail -c 32 | b64url)" \
    | openssl dgst -sha256 -binary | b64url)" || return 1

# sign_jwt <sub> <role> <ttl-seconds> [private key PEM]: EdDSA JWT with the claims Core signs
# ({ sub, role, exp, iss, aud }, no `sid`), under Core's `kid`. The optional key signs a forgery: a
# token claiming Core's `kid` but signed with another key, which the BFF must refuse.
sign_jwt() {
    local key="${4:-$JWT_PRIVATE_KEY}" header payload input signature
    header="$(printf '{"alg":"EdDSA","typ":"JWT","kid":"%s"}' "$JWT_KID" | b64url)"
    payload="$(printf '{"sub":"%s","role":"%s","exp":%d,"iss":"mairie360-core","aud":"mairie360"}' \
        "$1" "$2" "$(($(date +%s) + $3))" | b64url)"
    # `pkeyutl -rawin` (Ed25519) reads its input from a file, not from a pipe.
    input="$(mktemp)"
    printf '%s.%s' "$header" "$payload" >"$input"
    signature="$(openssl pkeyutl -sign -rawin -in "$input" -inkey <(printf '%s\n' "$key") | b64url)"
    rm -f "$input"
    [ -n "$signature" ] || return 1
    printf '%s.%s.%s' "$header" "$payload" "$signature"
}

# sign_jwt_file <file> <role> <ttl-seconds> <sub>...: writes { "<sub>": "<EdDSA JWT>", ... } to
# <file>, for k6, whose WebCrypto cannot sign Ed25519. Signed by node (thousands of tokens: one
# openssl run per token would take minutes), with the same header and claims as sign_jwt.
sign_jwt_file() {
    local file="$1" role="$2" ttl="$3"
    shift 3
    JWT_KID="$JWT_KID" node -e '
const crypto = require("node:crypto");
const fs = require("node:fs");
const [file, role, ttl, ...subs] = process.argv.slice(1);
const key = crypto.createPrivateKey(process.env.JWT_PRIVATE_KEY);
const b64url = (value) => Buffer.from(value).toString("base64url");
const header = b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: process.env.JWT_KID }));
const exp = Math.floor(Date.now() / 1000) + Number(ttl);
const tokens = {};
for (const sub of subs) {
  const payload = b64url(JSON.stringify({ sub, role, exp, iss: "mairie360-core", aud: "mairie360" }));
  const signature = crypto.sign(null, Buffer.from(`${header}.${payload}`), key).toString("base64url");
  tokens[sub] = `${header}.${payload}.${signature}`;
}
fs.writeFileSync(file, `${JSON.stringify(tokens)}\n`);
' "$file" "$role" "$ttl" "$@"
}

ADMIN_JWT="$(sign_jwt 1 admin 14400)" || return 1
export ADMIN_JWT
