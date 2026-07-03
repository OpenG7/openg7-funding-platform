import { CommandKey, CommandRequest } from '../types/index.js';

const allowedServices = ['api', 'cadvisor', 'traefik', 'web'] as const;
const forbiddenFragments = [
  'rm -rf',
  'shutdown',
  'reboot',
  'mkfs',
  'fdisk',
  'kill -9',
  'iptables'
];

const safePathPattern = /^\/[A-Za-z0-9._/@-]+$/;
const safeDomainPattern = /^[A-Za-z0-9.-]+$/;
const safeShaPattern = /^[a-f0-9]{7,40}$/;

export interface SafeCommand {
  readonly command: string;
  readonly description: string;
}

export class CommandRegistry {
  constructor(
    private readonly appDir: string,
    private readonly domain: string,
    private readonly healthPath: string
  ) {
    this.assertSafePath(appDir);
    this.assertSafeDomain(domain);
  }

  create(request: CommandRequest): SafeCommand {
    const params = request.params ?? {};

    const command = this.commandFor(request.key, params);
    this.assertNotForbidden(command.command);
    return command;
  }

  private commandFor(
    key: CommandKey,
    params: Record<string, string>
  ): SafeCommand {
    switch (key) {
      case 'backup':
        return {
          command: `tar -czf /tmp/openg7-agent-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C ${this.appDir} docker-compose.yml apps/funding-web/nginx.conf traefik .env.example`,
          description: 'Create a configuration backup archive in /tmp.'
        };
      case 'check_containers':
        return {
          command: `docker compose --project-directory ${this.appDir} ps`,
          description: 'List Docker Compose services.'
        };
      case 'check_cpu':
        return {
          command: 'top -bn1 | head -n 20',
          description: 'Read a CPU usage snapshot.'
        };
      case 'check_disk':
        return {
          command: 'df -P -h /',
          description: 'Read root filesystem usage.'
        };
      case 'check_docker':
        return {
          command: 'docker version',
          description: 'Check Docker client and server.'
        };
      case 'check_health':
        return {
          command: `curl -fsS --max-time 15 https://${this.domain}${this.healthPath}`,
          description: 'Check public health endpoint.'
        };
      case 'check_https':
        return {
          command: `curl -fsSIL --max-time 15 https://${this.domain}`,
          description: 'Check HTTPS response headers.'
        };
      case 'check_memory':
        return {
          command: 'free -m',
          description: 'Read memory usage.'
        };
      case 'check_ssl':
        return {
          command: `echo | openssl s_client -servername ${this.domain} -connect ${this.domain}:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates`,
          description: 'Read TLS certificate metadata.'
        };
      case 'deploy_build':
        return {
          command: `docker compose --project-directory ${this.appDir} build`,
          description: 'Build Docker Compose services.'
        };
      case 'deploy_pull':
        return {
          command: `git -C ${this.appDir} pull --ff-only`,
          description: 'Fast-forward the application repository.'
        };
      case 'deploy_up':
        return {
          command: `docker compose --project-directory ${this.appDir} up -d`,
          description: 'Start Docker Compose services.'
        };
      case 'fetch_logs':
        return {
          command: `docker compose --project-directory ${this.appDir} logs --tail=200 ${this.service(params.service)}`,
          description: 'Fetch recent service logs.'
        };
      case 'git_checkout':
        return {
          command: `git -C ${this.appDir} checkout ${this.sha(params.sha)}`,
          description: 'Checkout a previously recorded stable commit.'
        };
      case 'git_current_sha':
        return {
          command: `git -C ${this.appDir} rev-parse HEAD`,
          description: 'Read current Git commit.'
        };
      case 'restart_service':
        return {
          command: `docker compose --project-directory ${this.appDir} restart ${this.service(params.service)}`,
          description: 'Restart a Docker Compose service.'
        };
    }
  }

  private service(value: string | undefined): string {
    const service = value as (typeof allowedServices)[number] | undefined;
    if (service && allowedServices.includes(service)) {
      return service;
    }

    throw new Error(`Service is not allowed: ${value ?? '<empty>'}`);
  }

  private sha(value: string | undefined): string {
    if (value && safeShaPattern.test(value)) {
      return value;
    }

    throw new Error(`Git SHA is not allowed: ${value ?? '<empty>'}`);
  }

  private assertSafePath(path: string): void {
    if (!safePathPattern.test(path)) {
      throw new Error(`Unsafe application path: ${path}`);
    }
  }

  private assertSafeDomain(domain: string): void {
    if (!safeDomainPattern.test(domain)) {
      throw new Error(`Unsafe domain: ${domain}`);
    }
  }

  private assertNotForbidden(command: string): void {
    const lowered = command.toLowerCase();
    const match = forbiddenFragments.find((fragment) =>
      lowered.includes(fragment)
    );

    if (match) {
      throw new Error(`Forbidden command fragment detected: ${match}`);
    }
  }
}
