/**
 * Check whether `ip` matches a pattern that is either a plain IPv4 address
 * (exact match) or a CIDR notation like `192.168.1.0/24`.
 */
export function ipMatches(ip: string, pattern: string): boolean {
  if (!pattern.includes('/')) {
    return ip === pattern;
  }

  const [subnet, prefixStr] = pattern.split('/');
  if (!subnet || !prefixStr) return false;
  const prefix = parseInt(prefixStr, 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNumber(ip);
  const subnetNum = ipToNumber(subnet);
  if (ipNum === null || subnetNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (subnetNum & mask);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (Number.isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}
