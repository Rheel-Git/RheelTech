export const DEFAULT_STAFF_ORIGINS = Object.freeze([
  'https://rheeltech-staging-git-vercel-staging-rheel.vercel.app',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

export function getStaffOrigins(configuredOrigins = '', projectRef = '') {
  const origins = new Set(DEFAULT_STAFF_ORIGINS);
  if (projectRef === 'dxhzukuramncuhukonex') {
    origins.add('https://rheel-git.github.io');
    origins.add('https://rheeltech.ng');
  }
  for (const entry of configuredOrigins.split(',')) {
    const candidate = entry.trim();
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:')
        && parsed.origin === candidate && (parsed.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore malformed values; the rest of the explicit allowlist remains.
    }
  }
  return origins;
}

export function staffCorsHeaders(origin, allowedOrigins) {
  const result = new Headers({ 'Vary': 'Origin', 'Content-Type': 'application/json' });
  if (allowedOrigins.has(origin)) {
    result.set('Access-Control-Allow-Origin', origin);
    result.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    result.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return result;
}

export function logStaffDiagnostic(event, errorCode) {
  const safeEvent = /^[a-z0-9_]{1,80}$/.test(event) ? event : 'staff_management_diagnostic';
  const safeCode = typeof errorCode === 'string' && /^[0-9A-Z]{5}$/.test(errorCode)
    ? errorCode
    : undefined;
  console.error(JSON.stringify({ event: safeEvent, ...(safeCode ? { database_code: safeCode } : {}) }));
}
