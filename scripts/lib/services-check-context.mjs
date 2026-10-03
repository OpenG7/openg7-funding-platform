// Validation records contain labels and fixed guidance, never environment values.
export function createServicesCheckContext(env) {
  const checks = [];
  function readValue(name) {
    return `${env[name] ?? ''}`.trim();
  }

  function hasRealValue(name) {
    const value = readValue(name);
    return value.length > 0 && !isPlaceholder(value);
  }

  function isPlaceholder(value) {
    return /(?:\.\.\.|change[_-]?me|example\.com|remplace|replace|todo|your[_ -])/i.test(
      value
    );
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function safeUrl(value) {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  function isHttpsUrl(value) {
    const url = safeUrl(value);
    return url?.protocol === 'https:';
  }

  function required(section, name, hint) {
    if (!hasRealValue(name)) {
      record('missing', section, name, hint);
      return false;
    }

    record('ok', section, name, 'configured');
    return true;
  }

  function requiredSecret(section, name, hint, minLength) {
    if (!required(section, name, hint)) {
      return false;
    }

    if (readValue(name).length < minLength) {
      record(
        'missing',
        section,
        name,
        `must be at least ${minLength} characters`
      );
      return false;
    }

    return true;
  }

  function requiredPattern(section, name, pattern, hint) {
    if (!required(section, name, hint)) {
      return false;
    }

    if (!pattern.test(readValue(name))) {
      record('missing', section, name, hint);
      return false;
    }

    return true;
  }

  function requiredEmail(section, name, hint) {
    if (!required(section, name, hint)) {
      return false;
    }

    if (!isEmail(readValue(name))) {
      record('missing', section, name, 'set a valid email address');
      return false;
    }

    return true;
  }

  function requiredHttpsUrl(section, name, hint) {
    if (!required(section, name, hint)) {
      return false;
    }

    if (!isHttpsUrl(readValue(name))) {
      record('missing', section, name, hint);
      return false;
    }

    return true;
  }

  function requiredPositiveInteger(section, name, hint) {
    if (!required(section, name, hint)) {
      return false;
    }

    const value = Number(readValue(name));
    if (!Number.isSafeInteger(value) || value <= 0) {
      record('missing', section, name, hint);
      return false;
    }

    return true;
  }

  function requiredCredentialFreeHttpsUrl(section, name) {
    if (
      !requiredHttpsUrl(section, name, 'set an HTTPS URL without credentials')
    ) {
      return false;
    }

    const url = safeUrl(readValue(name));
    if (url.username || url.password) {
      record('missing', section, name, 'URL must not contain credentials');
      return false;
    }
    return true;
  }

  function optionalNonNegativeInteger(section, name, defaultValue, hint) {
    if (!hasRealValue(name)) {
      record('warn', section, name, `not set; defaults to ${defaultValue}`);
      return true;
    }

    const value = Number(readValue(name));
    if (!Number.isSafeInteger(value) || value < 0) {
      record('missing', section, name, hint);
      return false;
    }

    record('ok', section, name, 'configured');
    return true;
  }

  function optionalPositiveInteger(
    section,
    name,
    defaultValue,
    hint,
    maximum = Number.MAX_SAFE_INTEGER
  ) {
    if (!hasRealValue(name)) {
      record('warn', section, name, `not set; defaults to ${defaultValue}`);
      return true;
    }

    const value = Number(readValue(name));
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      record('missing', section, name, hint);
      return false;
    }

    record('ok', section, name, 'configured');
    return true;
  }

  function record(status, section, label, detail) {
    checks.push({ status, section, label, detail });
  }
  return {
    checks,
    readValue,
    hasRealValue,
    isEmail,
    safeUrl,
    required,
    requiredSecret,
    requiredPattern,
    requiredEmail,
    requiredHttpsUrl,
    requiredPositiveInteger,
    requiredCredentialFreeHttpsUrl,
    optionalNonNegativeInteger,
    optionalPositiveInteger,
    record
  };
}
