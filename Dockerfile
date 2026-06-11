FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html llms.txt favicon.svg /srv/
COPY assets /srv/assets
