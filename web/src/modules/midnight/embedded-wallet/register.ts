// Registers the embedded (passkey) wallet on window.midnight so the existing
// walletController discovers it exactly like an extension wallet. This module
// is imported for its side effect (see routes/__root.tsx) and must evaluate
// before the wallet auto-reconnect effect runs. It imports only light modules;
// the heavy wallet SDK is pulled in lazily inside connect().

import { networkId } from "@midnight-ntwrk/midnight-js";
import {
  EMBEDDED_WALLET_KEY,
  EMBEDDED_WALLET_NAME,
  EMBEDDED_WALLET_API_VERSION,
  endpointsForNetwork,
} from "./config";
import { createPasskey, derivePrfSecret } from "./passkey";
import { prfToSeedHex } from "./seed";
import { getCredentialRecord, saveCredentialRecord, clearCredentialRecord } from "./storage";
import { makeConnectedAPI, type EmbeddedConnectedAPI } from "./connected-api";
import type { EmbeddedSession } from "./wallet";

const FIXED_LABEL = "modular-starter wallet";

// A small fingerprint glyph as a data URL for the chooser/connected button icon.
const ICON_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>',
  );

interface LiveConnection {
  net: string;
  session: EmbeddedSession;
  connectedAPI: EmbeddedConnectedAPI;
}

let live: LiveConnection | null = null;
let inFlight: { net: string; promise: Promise<EmbeddedConnectedAPI> } | null = null;

async function doConnect(net: string): Promise<EmbeddedConnectedAPI> {
  const endpoints = endpointsForNetwork(net);

  // Get or create the passkey credential, then derive the seed via PRF.
  let record = getCredentialRecord();
  if (!record) {
    const ref = await createPasskey(FIXED_LABEL);
    record = saveCredentialRecord(ref);
  }
  const prf = await derivePrfSecret(record);
  const seedHex = await prfToSeedHex(prf);

  // Set the network id BEFORE building — config builders and createKeystore
  // read the global (walletController re-sets the same value after connect).
  networkId.setNetworkId(net as Parameters<typeof networkId.setNetworkId>[0]);

  const { startEmbeddedSession } = await import("./wallet");
  const session = await startEmbeddedSession(net, seedHex, endpoints);

  // Return once the first state emission is available (keys/addresses are
  // derivable immediately). Do NOT block connect on full sync — first sync on
  // preview/preprod can take minutes; balanceUnsealed waits for sync itself.
  await new Promise<void>((resolve) => {
    if (session.latestState()) return resolve();
    const t = setInterval(() => {
      if (session.latestState()) {
        clearInterval(t);
        resolve();
      }
    }, 100);
  });

  const connectedAPI = makeConnectedAPI(session, endpoints, net);
  live = { net, session, connectedAPI };

  // Auto-register NIGHT for DUST generation once funds arrive (fire-and-forget).
  session
    .waitForSynced()
    .then(() => session.registerDustIfNeeded())
    .catch((e) => console.warn("[embedded-wallet] dust registration failed", e));

  return connectedAPI;
}

async function connectEmbedded(net: string): Promise<EmbeddedConnectedAPI> {
  // Reuse a live connection for the same network (stable ConnectedAPI identity).
  if (live && live.net === net) return live.connectedAPI;
  // Coalesce concurrent connects (StrictMode double-mount / auto-reconnect).
  if (inFlight && inFlight.net === net) return inFlight.promise;
  // Different network requested — tear down the old session first.
  if (live && live.net !== net) {
    await lockEmbeddedWallet();
  }

  const promise = doConnect(net).finally(() => {
    if (inFlight && inFlight.promise === promise) inFlight = null;
  });
  inFlight = { net, promise };
  return promise;
}

function register(): void {
  if (typeof window === "undefined") return;
  const w = window as typeof window & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    midnight?: Record<string, any>;
  };
  w.midnight = {
    ...w.midnight,
    [EMBEDDED_WALLET_KEY]: {
      rdns: EMBEDDED_WALLET_KEY,
      name: EMBEDDED_WALLET_NAME,
      icon: ICON_DATA_URL,
      apiVersion: EMBEDDED_WALLET_API_VERSION,
      connect: (networkIdStr: string) => connectEmbedded(networkIdStr),
    },
  };
}

register();

// --- Dashboard helpers ---------------------------------------------------

export function getEmbeddedSessionInfo() {
  const record = getCredentialRecord();
  return {
    hasCredential: !!record,
    label: record?.label ?? null,
    createdAt: record?.createdAt ?? null,
    isLive: !!live,
    network: live?.net ?? null,
    session: live?.session ?? null,
  };
}

/** Forces a fresh passkey confirmation, then returns the 64-hex seed for backup. */
export async function revealSeed(): Promise<string> {
  const record = getCredentialRecord();
  if (!record) throw new Error("No embedded wallet passkey on this device.");
  const prf = await derivePrfSecret(record);
  return prfToSeedHex(prf);
}

/** Stops the live session (keeps the credential record for reconnect). */
export async function lockEmbeddedWallet(): Promise<void> {
  const current = live;
  live = null;
  inFlight = null;
  if (current) await current.session.stop();
}

/** Locks and forgets the stored credential record. */
export async function forgetEmbeddedCredential(): Promise<void> {
  await lockEmbeddedWallet();
  clearCredentialRecord();
}
