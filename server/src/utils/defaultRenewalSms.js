/**
 * Default SMS body when a package has no custom `renewalSmsBody`.
 * Placeholders: {{brand}}, {{name}}, {{package}}, {{paidUntil}}, {{secret}} (PPPoE), {{phone}} (remote).
 */
export function defaultRenewalSmsBodyForKind(kind) {
  if (kind === 'remote_access') {
    return '{{brand}}: Hi {{name}}, your remote access is successfully renewed until {{paidUntil}} ({{package}}). Thank you.';
  }
  if (kind === 'pppoe') {
    return '{{brand}}: Hi {{name}}, Your internet service on PPPoE line {{secret}} is successfully renewed until {{paidUntil}} ({{package}}). Thank you.';
  }
  return '{{brand}}: Hi {{name}}, your service is extended until {{paidUntil}} ({{package}}). Thank you.';
}
