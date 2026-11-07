// Public Ed25519 keys (base64url, raw 32 bytes) accepted for license signatures,
// indexed by key id (first 8 hex chars of SHA-256 of the raw key). Add a new key
// here to rotate; keep old ones while their licenses are still valid.
// The matching private key is NEVER stored in this repository.
export const LICENSE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  '5eb91449': 'lw8p2fygIOuT2H640A06-PbVHdmm-7fdn8CTQbukvaw',
};
