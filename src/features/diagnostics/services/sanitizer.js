const SENSITIVE_KEYS = new Set([
  'address',
  'ip',
  'ip_address',
  'local_ip',
  'remote_ip',
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
  'authorization',
  'proxy_authorization',
  'cookie',
  'set_cookie',
  'auth',
  'session',
  'token',
  'secret',
  'private_key',
].map((key) => key.replace(/[^a-z0-9]/gi, '').toLowerCase()))

const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const IPV6_PATTERN = /(^|[^a-f\d:])((?=[a-f\d:]*:)(?:[a-f\d]{0,4}:){2,7}[a-f\d]{0,4})(?=$|[^a-f\d:])/gi
const SDP_PATTERN = /(?:^|[\r\n]|\bSDP\s+)(?:v|o|s|c|t|m|a)=/i
const ICE_CANDIDATE_PATTERN = /\bcandidate:/i
const CANDIDATE_VALUE_PATTERN = /\b\d+\s+\d+\s+(?:udp|tcp)\s+\d+\s+\S+\s+\d+\s+typ\s+(?:host|srflx|prflx|relay)\b/gi
const URL_CREDENTIAL_PATTERN = /([a-z][a-z\d+.-]*:(?:\/\/)?)[^\s/@]+@/gi
const SECRET_QUERY_PATTERN = /([?&](?:[a-z\d_-]*(?:token|secret|password|credential)|api_?key|auth|session|cookie)=)(\[redacted secret\]|[^&#\s]*)/gi
const CREDENTIAL_VALUE_PATTERN = /\b(?:bearer|basic)\s+[a-z\d._~+/=-]+/gi
const SECRET_ASSIGNMENT_PATTERN = /\b([a-z\d_-]*(?:token|secret|password|credential)|api_?key|auth|session|cookie)=(\[redacted secret\]|[^\s,;]+)/gi

function normalizedKey(key) {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isSensitiveKey(key) {
  const normalized = normalizedKey(key)
  return normalized === 'label' || SENSITIVE_KEYS.has(normalized) || /(?:token|secret|password|privatekey|apikey|devicelabel|tracklabel|icecandidate|rawcandidate)$/.test(normalized) ||
    /^(?:local|remote|ip)?address$/.test(normalized) ||
    /^(?:local|remote)ip$/.test(normalized)
}

function sanitizeString(value) {
  if (SDP_PATTERN.test(value)) return '[redacted protocol description]'
  if (ICE_CANDIDATE_PATTERN.test(value)) return '[redacted candidate]'
  return value
    .replace(CANDIDATE_VALUE_PATTERN, '[redacted candidate]')
    .replace(URL_CREDENTIAL_PATTERN, '$1[redacted credentials]@')
    .replace(SECRET_QUERY_PATTERN, '$1[redacted secret]')
    .replace(CREDENTIAL_VALUE_PATTERN, '[redacted credentials]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1=[redacted secret]')
    .replace(IPV4_PATTERN, '[redacted IP]')
    .replace(IPV6_PATTERN, (match, prefix, address) => {
      const looksLikeAddress = address.includes('::') || address.split(':').length >= 6
      return looksLikeAddress ? `${prefix}[redacted IP]` : match
    })
}

function containsUnredactedUrlSecret(value) {
  URL_CREDENTIAL_PATTERN.lastIndex = 0
  if ([...value.matchAll(URL_CREDENTIAL_PATTERN)].some((match) => !match[0].includes('[redacted credentials]'))) {
    return true
  }
  SECRET_QUERY_PATTERN.lastIndex = 0
  return [...value.matchAll(SECRET_QUERY_PATTERN)].some((match) => match[2] !== '[redacted secret]')
}

function containsUnredactedCredential(value) {
  CREDENTIAL_VALUE_PATTERN.lastIndex = 0
  if (CREDENTIAL_VALUE_PATTERN.test(value)) return true
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
  return [...value.matchAll(SECRET_ASSIGNMENT_PATTERN)].some((match) => match[2] !== '[redacted secret]')
}

function hasSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, nested]) => isSensitiveKey(key) || hasSensitiveKey(nested),
  )
}

function containsIpv6(value) {
  IPV6_PATTERN.lastIndex = 0
  return [...value.matchAll(IPV6_PATTERN)].some((match) => {
    const address = match[2]
    return address.includes('::') || address.split(':').length >= 6
  })
}

export function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSensitiveKey(key))
        .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]),
    )
  }
  return typeof value === 'string' ? sanitizeString(value) : value
}

export function containsSensitiveData(value) {
  const serialized = JSON.stringify(value)
  IPV4_PATTERN.lastIndex = 0
  IPV6_PATTERN.lastIndex = 0
  CANDIDATE_VALUE_PATTERN.lastIndex = 0
  return (
    IPV4_PATTERN.test(serialized) ||
    containsIpv6(serialized) ||
    SDP_PATTERN.test(serialized) ||
    ICE_CANDIDATE_PATTERN.test(serialized) ||
    CANDIDATE_VALUE_PATTERN.test(serialized) ||
    containsUnredactedUrlSecret(serialized) ||
    containsUnredactedCredential(serialized) ||
    hasSensitiveKey(value)
  )
}
