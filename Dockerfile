FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html llms.txt favicon.svg robots.txt sitemap.xml /srv/
COPY assets /srv/assets
COPY seedance /srv/seedance
COPY kling /srv/kling
COPY custom /srv/custom
COPY use-cases /srv/use-cases
COPY what-is-x402 /srv/what-is-x402
COPY compare /srv/compare
# NOTE: this COPY list is an allowlist — a page directory that exists in the repo but
# is not listed here 404s in production while still being linked and sitemapped.
# `image/` is deliberately NOT shipped: Grok Imagine is an unlisted gateway preview
# (see the MODEL_CARDS comment in index.html). Ship it in the same change that flips
# those cards back to `live: true`, not before.
