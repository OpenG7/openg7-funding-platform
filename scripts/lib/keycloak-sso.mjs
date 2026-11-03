import { createHash, randomUUID } from 'node:crypto';
import { keycloakHttpsRequest } from './keycloak-provision-user.mjs';

export const keycloakSsoFlow = 'openg7-browser-sso';
const strictFlow = 'openg7-password-otp';
const credentialsFlow = 'openg7-sso-password-otp';
const credentialsDescription =
  'OpenG7 managed SSO credentials: required password and OTP with native factor references.';
const wrapperDescription =
  'Reuse the realm session; a new session requires password and OTP. Applications verify the completed MFA reference.';
const factors = [
  {
    provider: 'auth-username-password-form',
    priority: 10,
    alias: 'openg7-sso-password-reference',
    reference: 'pwd',
    step: 'password'
  },
  {
    provider: 'auth-otp-form',
    priority: 20,
    alias: 'openg7-sso-otp-reference',
    reference: 'mfa',
    step: 'otp'
  }
];
const base = '/admin/realms/openg7';
const authentication = base + '/authentication';
const validId = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,255}$/.test(value);
const failure = () =>
  new Error(
    'Cannot reconcile Keycloak SSO safely. Preserve the realm and inspect its authentication flows before retrying.'
  );

/** Prepare a separate, controlled MFA path; preserve the original flow and configurations. */
export async function reconcileKeycloakSso({
  issuer,
  accessToken,
  ca,
  apply = false,
  request = keycloakHttpsRequest,
  audit = () => {}
}) {
  let endpoint;
  try {
    endpoint = new URL(issuer);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.pathname !== '/realms/openg7' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      typeof accessToken !== 'string' ||
      !accessToken ||
      accessToken.length > 65_536 ||
      /\s/.test(accessToken) ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
    )
      throw failure();
  } catch {
    throw failure();
  }
  const correlation = randomUUID(),
    target = createHash('sha256').update(endpoint.href).digest('hex');
  const record = (result, step) =>
    audit({
      date: new Date().toISOString(),
      action: 'keycloak.sso.configure',
      actor: 'administrative-token',
      target,
      correlation,
      result,
      ...(step ? { step } : {})
    });
  const exchange = (path, method = 'GET', body) =>
    request({
      url: endpoint.origin + path,
      method,
      ca,
      timeoutMs: 10_000,
      headers: {
        Authorization: 'Bearer ' + accessToken,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  const read = async (path) => {
    const response = await exchange(path);
    if (
      response?.status !== 200 ||
      typeof response.body !== 'string' ||
      response.body.length > 1024 * 1024
    )
      throw failure();
    return JSON.parse(response.body);
  };
  const readRealm = async () => {
    const realm = await read(base);
    if (
      realm.realm !== 'openg7' ||
      !validId(realm.id) ||
      realm.enabled !== true ||
      realm.sslRequired?.toLowerCase() !== 'all' ||
      ![strictFlow, keycloakSsoFlow].includes(realm.browserFlow) ||
      !Number.isInteger(realm.ssoSessionMaxLifespan) ||
      realm.ssoSessionMaxLifespan < 1 ||
      realm.ssoSessionMaxLifespan > 3600
    )
      throw failure();
    return realm;
  };
  const findFlow = async (alias, description) => {
    const flows = await read(authentication + '/flows');
    if (!Array.isArray(flows) || flows.length > 256) throw failure();
    const matches = flows.filter((flow) => flow.alias === alias);
    if (matches.length > 1) throw failure();
    const flow = matches[0];
    if (
      flow &&
      (!validId(flow.id) ||
        flow.providerId !== 'basic-flow' ||
        flow.topLevel !== true ||
        flow.builtIn !== false ||
        (description && flow.description !== description))
    )
      throw failure();
    return flow;
  };
  const executions = async (alias) => {
    const steps = await read(
      authentication + '/flows/' + alias + '/executions'
    );
    if (
      !Array.isArray(steps) ||
      steps.length > 8 ||
      steps.some((step) => !validId(step.id))
    )
      throw failure();
    return steps;
  };
  const readFactors = async (alias, partial = false) => {
    const steps = await executions(alias);
    if (steps.length > 2 || (!partial && steps.length !== 2)) throw failure();
    const found = new Map();
    for (const step of steps) {
      const factor = factors.find(
        (candidate) =>
          candidate.provider === step.providerId &&
          candidate.priority === step.priority
      );
      if (
        !factor ||
        found.has(factor.step) ||
        step.authenticationFlow === true ||
        step.requirement !== 'REQUIRED'
      )
        throw failure();
      found.set(factor.step, step);
    }
    return found;
  };
  const readSource = async () => {
    const flow = await findFlow(strictFlow);
    if (!flow) throw failure();
    await readFactors(strictFlow);
    return flow;
  };
  const readCredentials = async () => {
    const flow = await findFlow(credentialsFlow, credentialsDescription);
    if (!flow) return { flow, steps: new Map(), configured: new Set() };
    const steps = await readFactors(credentialsFlow, true),
      configured = new Set();
    for (const factor of factors) {
      const step = steps.get(factor.step);
      if (!step?.authenticationConfig) continue;
      if (!validId(step.authenticationConfig)) throw failure();
      const config = await read(
        authentication + '/config/' + step.authenticationConfig
      );
      if (config.alias !== factor.alias) throw failure();
      // Keycloak 26.8 masks common AMR values even for administrators. Known
      // managed config identities can be retained; masked contents are never
      // presented as verified. Actual signed token assurance needs a login test.
      for (const [key, expected] of [
        ['default.reference.value', factor.reference],
        ['default.reference.maxAge', '3600']
      ]) {
        if (![expected, '**********'].includes(config.config?.[key]))
          throw failure();
      }
      configured.add(factor.step);
    }
    return { flow, steps, configured };
  };
  const readSso = async (credentials) => {
    const flow = await findFlow(keycloakSsoFlow, wrapperDescription);
    if (!flow) return { flow, cookie: false, credentials: false };
    const steps = (await executions(keycloakSsoFlow)).filter(
      (step) => step.level === 0
    );
    let cookie = false,
      branch = false;
    for (const step of steps) {
      if (step.requirement !== 'ALTERNATIVE') throw failure();
      if (
        step.providerId === 'auth-cookie' &&
        step.authenticationFlow !== true &&
        step.priority === 10 &&
        !step.authenticationConfig &&
        !cookie
      )
        cookie = true;
      else if (
        step.authenticationFlow === true &&
        step.flowId === credentials.flow?.id &&
        step.priority === 20 &&
        !branch
      )
        branch = true;
      else throw failure();
    }
    return { flow, cookie, credentials: branch };
  };
  // An uncertain write is followed by one bounded read, never by an automatic replay.
  const mutate = async (step, path, method, body, verify) => {
    await record('started', step);
    let response;
    try {
      response = await exchange(path, method, body);
    } catch {}
    if (
      !(await verify()) ||
      (response && ![201, 204, 409].includes(response.status))
    )
      throw failure();
    await record('verified', step);
  };
  try {
    const realm = await readRealm(),
      source = await readSource();
    let credentials = await readCredentials(),
      sso = await readSso(credentials);
    if (
      realm.browserFlow === keycloakSsoFlow &&
      (!sso.cookie || !sso.credentials || credentials.configured.size !== 2)
    )
      throw failure();
    const changes = [
      ...(!credentials.flow ? ['create_sso_credentials_flow'] : []),
      ...factors.flatMap((factor) => [
        ...(!credentials.steps.has(factor.step)
          ? ['add_required_' + factor.step]
          : []),
        ...(!credentials.configured.has(factor.step)
          ? ['configure_' + factor.step + '_reference']
          : [])
      ]),
      ...(!sso.flow ? ['create_sso_flow'] : []),
      ...(!sso.cookie ? ['add_session_cookie'] : []),
      ...(!sso.credentials ? ['add_required_mfa_path'] : []),
      ...(realm.browserFlow !== keycloakSsoFlow
        ? ['bind_sso_browser_flow']
        : [])
    ];
    if (!apply)
      return {
        mode: 'plan',
        changes,
        assurance: 'signed_mfa_login_test_required'
      };
    await record('started');
    if (!credentials.flow)
      await mutate(
        'create_sso_credentials_flow',
        authentication + '/flows',
        'POST',
        {
          alias: credentialsFlow,
          providerId: 'basic-flow',
          topLevel: true,
          builtIn: false,
          description: credentialsDescription
        },
        async () => Boolean((credentials = await readCredentials()).flow)
      );
    for (const factor of factors) {
      if (!credentials.steps.has(factor.step))
        await mutate(
          'add_required_' + factor.step,
          authentication + '/executions',
          'POST',
          {
            parentFlow: credentials.flow.id,
            authenticator: factor.provider,
            authenticatorFlow: false,
            requirement: 'REQUIRED',
            priority: factor.priority
          },
          async () =>
            (credentials = await readCredentials()).steps.has(factor.step)
        );
      if (!credentials.configured.has(factor.step))
        await mutate(
          'configure_' + factor.step + '_reference',
          authentication +
            '/executions/' +
            credentials.steps.get(factor.step).id +
            '/config',
          'POST',
          {
            alias: factor.alias,
            config: {
              'default.reference.value': factor.reference,
              'default.reference.maxAge': '3600'
            }
          },
          async () =>
            (credentials = await readCredentials()).configured.has(factor.step)
        );
    }
    if (!sso.flow)
      await mutate(
        'create_sso_flow',
        authentication + '/flows',
        'POST',
        {
          alias: keycloakSsoFlow,
          providerId: 'basic-flow',
          topLevel: true,
          builtIn: false,
          description: wrapperDescription
        },
        async () => Boolean((sso = await readSso(credentials)).flow)
      );
    if (!sso.cookie)
      await mutate(
        'add_session_cookie',
        authentication + '/executions',
        'POST',
        {
          parentFlow: sso.flow.id,
          authenticator: 'auth-cookie',
          authenticatorFlow: false,
          requirement: 'ALTERNATIVE',
          priority: 10
        },
        async () => (sso = await readSso(credentials)).cookie
      );
    if (!sso.credentials)
      await mutate(
        'add_required_mfa_path',
        authentication + '/executions',
        'POST',
        {
          parentFlow: sso.flow.id,
          flowId: credentials.flow.id,
          authenticatorFlow: true,
          requirement: 'ALTERNATIVE',
          priority: 20
        },
        async () => (sso = await readSso(credentials)).credentials
      );
    const current = await readRealm();
    if (current.id !== realm.id || (await readSource()).id !== source.id)
      throw failure();
    credentials = await readCredentials();
    sso = await readSso(credentials);
    if (credentials.configured.size !== 2 || !sso.cookie || !sso.credentials)
      throw failure();
    if (current.browserFlow !== keycloakSsoFlow)
      await mutate(
        'bind_sso_browser_flow',
        base,
        'PUT',
        { browserFlow: keycloakSsoFlow },
        async () => (await readRealm()).browserFlow === keycloakSsoFlow
      );
    await record('verified');
    return {
      mode: 'apply',
      changes,
      assurance: 'signed_mfa_login_test_required'
    };
  } catch {
    if (apply) {
      try {
        await record('failed');
      } catch {}
    }
    throw failure();
  }
}
