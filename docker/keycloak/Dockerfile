FROM quay.io/keycloak/keycloak:26.8.0 AS builder

ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
# The database readiness check requires metrics; both remain on private port 9000.
ENV KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.8.0
COPY --from=builder --chown=1000:0 /opt/keycloak/ /opt/keycloak/
COPY --chown=1000:0 --chmod=0755 docker/keycloak/healthcheck.sh /opt/keycloak/bin/container-healthcheck.sh
COPY --chown=1000:0 docker/keycloak/openg7-realm.json /opt/keycloak/data/import/openg7-realm.json

USER 1000
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
