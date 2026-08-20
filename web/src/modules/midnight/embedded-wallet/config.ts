// Embedded (passkey) wallet identity and per-network endpoints.
//
// The endpoints mirror node/src/config.ts exactly so the browser wallet talks
// to the same indexer / node / proof server the node package uses. The proof
// server is always local (127.0.0.1:6300) — proving is not hosted.

export const EMBEDDED_WALLET_KEY = "embedded"; // window.midnight key + rdns + localStorage 'rdns-connected' value
export const EMBEDDED_WALLET_NAME = "Passkey Wallet";
export const EMBEDDED_WALLET_API_VERSION = "4.0.1";

export interface EmbeddedEndpoints {
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
}

// Keys match the networkID enum in wallet-widget/ui/common/common-values.tsx.
export const EMBEDDED_ENDPOINTS: Record<string, EmbeddedEndpoints> = {
  undeployed: {
    indexer: "http://127.0.0.1:8088/api/v4/graphql",
    indexerWS: "ws://127.0.0.1:8088/api/v4/graphql/ws",
    node: "http://127.0.0.1:9944",
    proofServer: "http://127.0.0.1:6300",
  },
  preview: {
    indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
    node: "https://rpc.preview.midnight.network",
    proofServer: "http://127.0.0.1:6300",
  },
  preprod: {
    indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
    node: "https://rpc.preprod.midnight.network",
    proofServer: "http://127.0.0.1:6300",
  },
  mainnet: {
    indexer: "https://indexer.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.midnight.network/api/v4/graphql/ws",
    node: "https://rpc.midnight.network",
    proofServer: "http://127.0.0.1:6300",
  },
};

export function endpointsForNetwork(net: string): EmbeddedEndpoints {
  const endpoints = EMBEDDED_ENDPOINTS[net];
  if (!endpoints) {
    throw new Error(`Embedded wallet does not support network "${net}".`);
  }
  return endpoints;
}
