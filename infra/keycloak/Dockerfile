FROM quay.io/keycloak/keycloak:26.1.0

COPY realm-import /opt/keycloak/data/import

# Railway terminates TLS at its proxy. Keycloak uses the forwarded headers to
# generate its HTTPS issuer and redirect URLs, then listens on Railway's PORT.
ENTRYPOINT ["/bin/sh", "-c", "/opt/keycloak/bin/kc.sh start --http-enabled=true --http-port=${PORT:-8080} --proxy-headers=xforwarded --hostname-strict=false --import-realm"]
