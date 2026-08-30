const SENSITIVE_KEYS = new Set([
  'address',
  'ip',
  'ip_address',
  'local_address',
  'remote_address',
  'candidate',
  'raw_candidate',
  'sdp',
  'offer',
  'answer',
  'device_label',
  'credential',
  'credentials',
  'token',
  'secret',
  'private_key',
])

const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6_PATTERN = /\b(?:[a-f\d]{1,4}:){2,7}[a-f\d]{0,4}\b/gi
const SDP_PATTERN = /(?:^|\n)\s*(?:v|o|s|c|t|m|a)=/i

function sanitizeString(value) {
  if (SDP_PATTERN.test(value)) return '[redacted protocol description]'
  return value
    .replace(IPV4_PATTERN, '[redacted IP]')
    .replace(IPV6_PATTERN, '[redacted IP]')
}

export function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEYS.has(key.toLowerCase()))
        .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]),
    )
  }
  return typeof value === 'string' ? sanitizeString(value) : value
}

export function containsSensitiveData(value) {
  const serialized = JSON.stringify(value)
  IPV4_PATTERN.lastIndex = 0
  IPV6_PATTERN.lastIndex = 0
  return IPV4_PATTERN.test(serialized) || IPV6_PATTERN.test(serialized) || SDP_PATTERN.test(serialized)
}
