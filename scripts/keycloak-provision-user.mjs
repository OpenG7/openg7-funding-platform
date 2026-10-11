#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDockerConfiguration } from './lib/docker-environment.mjs';
import { validateKeycloakProvisionUserConfig } from './lib/keycloak-config.mjs';
import {
  provisionKeycloakUser,
  restoreKeycloakOwnerSubjects
} from './lib/keycloak-provision-user.mjs';

try {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length &&
      ![
        '--help',
        '--dry-run',
        '--subjects-only',
        '--restore-subjects-only'
      ].includes(args[0]))
  )
    throw new Error(
      'Usage: yarn keycloak:provision-user [--dry-run|--subjects-only|--restore-subjects-only|--help]'
    );
  if (args[0] === '--help') {
    console.log(
      'Provision the configured openg7 user with FUNDING_KEYCLOAK_PROVISION_USER=true. Creates only an absent account; requires personal password change and OTP. Existing users require a verified owner UUID or private state. --dry-run validates configuration without contacting Keycloak or writing files. --subjects-only returns private owner UUIDs for deployment capture. --restore-subjects-only restores verified private owner state for rollback without contacting the provider or writing files; it does not verify current OTP enrollment. Never print either machine output in logs.'
    );
  } else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const env = readDockerConfiguration({ cwd: root });
    const enabled = validateKeycloakProvisionUserConfig(env);
    const machineOutput = [
      '--subjects-only',
      '--restore-subjects-only'
    ].includes(args[0]);
    if (machineOutput && !enabled)
      throw new Error(
        'Machine provisioning output requires FUNDING_KEYCLOAK_PROVISION_USER=true.'
      );
    if (args[0] === '--dry-run') {
      console.log(
        enabled
          ? 'Keycloak user provisioning configuration is valid. No provider contact, account or private state changes.'
          : 'Keycloak user provisioning is disabled. No provider contact or changes.'
      );
    } else {
      const result =
        args[0] === '--restore-subjects-only'
          ? restoreKeycloakOwnerSubjects({ root, env })
          : await provisionKeycloakUser({
              root,
              env,
              requireEnrollment:
                args[0] === '--subjects-only' &&
                env.FUNDING_PLATFORM_ENV === 'production'
            });
      if (machineOutput)
        console.log(
          env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS.split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .join(',')
        );
      else
        console.log(
          result
            ? 'Keycloak user verified and private owner configuration prepared. Password change and OTP enrollment remain personal. Deployment launchers pass the owner configuration to the API.'
            : 'Keycloak user provisioning is disabled.'
        );
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
