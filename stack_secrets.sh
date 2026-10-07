#!/usr/bin/env bash

# Sourced by security_test.sh and performance_test.sh (MAIR-428, MAIR-474).
#
# Each run of a test stack gets its own random JWT_SECRET, and the admin JWT the scans need
# (`sub=1`, the Admin seeded by liquibase, `role=admin`, valid 4 hours) is signed with it here,
# exactly like mairie360_api_lib::jwt_manager does (HS256, claims { sub, role, exp }). Nothing
# signed with a committed secret is left in the repository: the repos are public, so a committed
# token would be an admin token anywhere that secret was reused.
#
# Exports JWT_SECRET (kept when already set), ADMIN_JWT and USER_JWT (`sub=2`, the `User` account of
# init-test.sql, `role=user`, valid 4 hours). Needs openssl.

if [ -z "${JWT_SECRET:-}" ]; then
    JWT_SECRET="$(openssl rand -hex 32)" || return 1
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

jwt_header="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"
jwt_payload="$(printf '{"sub":"1","role":"admin","exp":%s}' "$(( $(date +%s) + 4 * 3600 ))" | b64url)"
jwt_signature="$(printf '%s.%s' "$jwt_header" "$jwt_payload" \
    | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)"
ADMIN_JWT="$jwt_header.$jwt_payload.$jwt_signature"
jwt_payload="$(printf '{"sub":"2","role":"user","exp":%s}' "$(( $(date +%s) + 4 * 3600 ))" | b64url)"
jwt_signature="$(printf '%s.%s' "$jwt_header" "$jwt_payload" \
    | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)"
USER_JWT="$jwt_header.$jwt_payload.$jwt_signature"
unset jwt_header jwt_payload jwt_signature

export JWT_SECRET ADMIN_JWT USER_JWT
