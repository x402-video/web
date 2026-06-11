FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html llms.txt favicon.svg robots.txt sitemap.xml /srv/
COPY assets /srv/assets
COPY seedance /srv/seedance
COPY kling /srv/kling
COPY custom /srv/custom
COPY use-cases /srv/use-cases
