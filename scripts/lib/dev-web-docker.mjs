const developmentRouter = `    openg7-angular-dev:
      rule: 'Host(\`localhost\`) && !PathPrefix(\`/api\`)'
      entryPoints:
        - websecure
      service: openg7-angular-dev
      priority: 20
      middlewares:
        - secure-headers
        - web-in-flight
        - compress
      tls: {}

`;

const developmentService = `    openg7-angular-dev:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: 'http://host.docker.internal:4200'

`;

/** Keep HTTPS, OIDC and API routing intact while serving the local Angular watch build. */
export function localDevWebConfiguration(source) {
  if (typeof source !== 'string' || source.includes('openg7-angular-dev'))
    throw new Error('Invalid or already configured local Angular gateway.');

  const http = [...source.matchAll(/^http:\r?$/gm)];
  const routers = [...source.matchAll(/^  routers:(\r?\n)/gm)];
  const services = [...source.matchAll(/^  services:(\r?\n)/gm)];
  if (
    http.length !== 1 ||
    routers.length !== 1 ||
    services.length !== 1 ||
    !/^http:\r?\n  routers:\r?\n/m.test(source) ||
    services[0].index <= routers[0].index ||
    /^\S/m.test(source.slice(routers[0].index, services[0].index))
  )
    throw new Error(
      'Missing or ambiguous local Traefik HTTP routing sections.'
    );

  return source
    .replace(
      /^  routers:(\r?\n)/m,
      (anchor, newline) => anchor + developmentRouter.replaceAll('\n', newline)
    )
    .replace(
      /^  services:(\r?\n)/m,
      (anchor, newline) => anchor + developmentService.replaceAll('\n', newline)
    );
}
