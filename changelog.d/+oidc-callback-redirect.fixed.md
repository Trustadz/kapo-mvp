**PocketID sign-in behind a TLS-terminating reverse proxy.** The callback now
derives the token exchange's `redirect_uri` from the same canonical
`KAPO_PUBLIC_URL` origin as the authorization request instead of the container's
internal request URL. Nginx Proxy Manager and similar proxies no longer end with
`invalid_grant`; state, nonce and PKCE validation are unchanged.
