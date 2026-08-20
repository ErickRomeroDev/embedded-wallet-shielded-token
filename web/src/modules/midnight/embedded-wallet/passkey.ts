// Passkey (WebAuthn) secret derivation via the PRF extension.
//
// The PRF output is a deterministic 32 bytes for a fixed, domain-separated
// salt: re-derivable on every future assertion from the same authenticator,
// never persisted, and hardware-bound to the extent the authenticator is.
// We feed it through HKDF (see seed.ts) to produce the HD wallet seed.
//
// Flow notes:
//   - PRF results are only guaranteed during get() (assertion), not create(),
//     so first-time onboarding performs create() followed by one get().
//   - Browsers require a user gesture and a secure context (localhost is fine).
//
// Lifted from the passport foundations demo with the domain tags and RP name
// changed for this app.

const PRF_SALT = new TextEncoder().encode("mintkey:prf:seed:v0");

const RP_NAME = "MintKey";

export interface PasskeyRef {
  credentialIdB64: string;
  label: string;
}

function isIpHost(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === "[::1]";
}

function rpEntity(): PublicKeyCredentialRpEntity {
  const hostname = window.location.hostname;
  if (hostname === "localhost") return { name: RP_NAME, id: "localhost" };
  if (hostname.endsWith(".localhost")) return { name: RP_NAME, id: hostname };
  if (isIpHost(hostname)) return { name: RP_NAME };
  return { name: RP_NAME, id: hostname };
}

function explainPasskeyError(error: unknown): string {
  const message = String((error as { message?: unknown })?.message ?? error);
  if (/invalid domain|relying party|rp id|security/i.test(message)) {
    return "Passkeys need a valid local domain. Open the app at http://localhost:5174/ and try again.";
  }
  return message;
}

function b64encode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bytes = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return out;
}

async function userIdForLabel(label: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(`mintkey:user:v0:${label}`);
  return crypto.subtle.digest("SHA-256", data);
}

/**
 * Create a new passkey with the PRF extension enabled. Throws with actionable
 * copy if the authenticator does not support PRF.
 */
export async function createPasskey(label: string): Promise<PasskeyRef> {
  const stableLabel = label.trim().toLowerCase();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: rpEntity(),
        user: {
          id: await userIdForLabel(stableLabel),
          name: stableLabel,
          displayName: stableLabel,
        },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extensions: { prf: {} } as any,
      },
    })) as PublicKeyCredential | null;
  } catch (error) {
    throw new Error(explainPasskeyError(error));
  }
  if (!cred) throw new Error("passkey creation was cancelled");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext: any = cred.getClientExtensionResults();
  if (!ext?.prf?.enabled) {
    throw new Error(
      "This authenticator does not support the WebAuthn PRF extension. " +
        "Use a platform passkey (Touch ID / Windows Hello / recent Android) or a PRF-capable security key.",
    );
  }
  return { credentialIdB64: b64encode(cred.rawId), label: stableLabel };
}

/**
 * Evaluate the PRF for our fixed salt — returns the 32-byte secret. When `ref`
 * is omitted the browser offers any resident passkey for this origin.
 */
export async function derivePrfSecret(ref?: PasskeyRef): Promise<Uint8Array> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: ref
        ? [{ type: "public-key", id: b64decode(ref.credentialIdB64) }]
        : [],
      userVerification: "required",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("passkey assertion was cancelled");

  const result: ArrayBuffer | undefined = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assertion.getClientExtensionResults() as any
  )?.prf?.results?.first;
  if (!result) {
    throw new Error(
      "This passkey doesn't support the PRF extension, which the embedded wallet needs to derive its seed. " +
        "Windows Hello and some security keys don't support PRF. Try a Google Password Manager passkey " +
        "(Android / ChromeOS), an iCloud Keychain passkey (macOS/iOS 18+), or a PRF-capable security key.",
    );
  }
  const secret = new Uint8Array(result);
  if (secret.length !== 32) throw new Error(`unexpected PRF output length ${secret.length}`);
  return secret;
}
