# MintKey

This project is built on the Midnight Network.

**MintKey is a passkey-owned shielded token mint on the Midnight Network.** You create a WebAuthn passkey in your browser, and that passkey becomes the on-chain token authority: only you can mint and burn **MintKey Token (MKT)**, a native shielded (Zswap) token. Everything runs browser-native — the Midnight wallet itself is derived from the passkey (WebAuthn PRF → HKDF → wallet SDK in-browser), so there is **no extension dependency, no seed phrase to type, and no secret that ever leaves your device**.

What the embedded wallet unlocks: a full shielded-token flow — sync, balance, transaction balancing, signing, submission — entirely inside the browser page. The current Lace shielded-spend issue makes this pattern especially useful *today* (extension users can't spend shielded coins), but that's context, not the reason MintKey exists: the passkey wallet is an identity and custody model of its own, and everything here stands unchanged once the extension issue is fixed.

**Live demo:** _redeploy pending — see Getting started_

## How it works

One passkey, two domain-separated HKDF derivations of its PRF output:

```
WebAuthn passkey ──PRF──▶ 32-byte secret
   ├── HKDF("mintkey:wallet-seed:v0") ──▶ HD wallet seed  → shielded/unshielded/dust wallets
   └── HKDF("mintkey:owner-sk:v0")    ──▶ owner secret sk → commitment = persistentHash([sk])
```

- At **deploy**, the contract constructor stores your commitment `persistentHash([sk])` in the `Ownable` module's ledger state. Only the hash goes on-chain.
- At **mint/burn**, the circuit calls `Ownable_assertOnlyOwner()`: the `wit_OwnableSK` witness injects your secret into the ZK proof, which recomputes the hash and asserts it matches the stored commitment. The proof reveals nothing beyond "the caller knows the preimage" — a private, gated circuit.
- **Public** on-chain: the owner commitment, token metadata, and mint amounts (a protocol requirement — value created ex nihilo must be publicly accounted). **Private**: the owner secret, mint recipients and nonces, and all burn arguments.

## Prerequisites

- **Node.js ≥ 22** and **pnpm 10**
- **Docker** (standalone network: `midnight-node` 0.22.2, `indexer-standalone` 4.0.1, `proof-server` 8.0.3). All three services pin `platform: linux/amd64`, so every machine runs the binaries this stack is verified against. **On Apple Silicon these run under emulation** — everything works, but wallet sync and proving are slower; the waits are bounded and report a diagnostic rather than hanging.
- **Compact developer tools** with **compiler 0.31.0** (`compact compile +0.31.0` is pinned in the contract package):
  ```bash
  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  compact update 0.31.0
  ```
- **A PRF-capable passkey authenticator**: Touch ID / iCloud Keychain (macOS/iOS 18+), Google Password Manager passkeys (Android/ChromeOS), or a PRF-capable security key. Windows Hello does **not** support the PRF extension.
- Chrome or another browser with WebAuthn PRF support; open the app at `http://localhost:5174/` (passkeys need a valid domain — bare IPs won't work).

> **Preview / Preprod caveat:** deploying and minting on a public testnet needs a **faucet-funded wallet** ([preview faucet](https://faucet.preview.midnight.network/)), generated **tDUST** for fees (NIGHT must be registered for DUST generation — the app and deploy scripts do this automatically, but generation takes a few minutes), and the **local proof server** running (`docker compose -f node/proof-server.yml up -d`). First wallet sync on a public network can take several minutes. The end-to-end flow is execution-verified on standalone by the `E2E (standalone)` workflow, which runs on both amd64 and arm64 runners; on preview/preprod expect the same flow with longer waits.

## Getting started

```bash
pnpm install
pnpm compact   # compile the contract (populates contract/src/managed)
pnpm build
```

**1. Get your owner commitment (browser).** Start the frontend — with no contract configured it renders a bootstrap page:

```bash
pnpm dev:frontend   # http://localhost:5174/
```

Click **"Create / show my owner commitment"** — this creates your passkey (first time) and shows the 64-hex commitment. Copy it.

**2. Deploy (node).** Configure `node/.env` from `node/.env_template`, at minimum:

```bash
OWNER_COMMITMENT="<the hex you copied>"
MY_UNDEPLOYED_UNSHIELDED_ADDRESS="mn_addr_undeployed1..."   # optional NIGHT funding target
```

```bash
pnpm deploy-standalone   # starts the docker stack, deploys, funds NIGHT
```

The deploy cannot mint tokens — mint is gated to *your* passkey, and the deploy script never sees your secret. It writes `node/deployments/undeployed.json` with the contract address.

**3. Join and mint (browser).** Put the address in `web/.env` (`VITE_CONTRACT_ADDRESS="..."`), restart Vite, connect the **Passkey Wallet**, and open the **Mint** page. You'll see *"You are the token authority"* — mint MKT to yourself, watch the shielded balance appear, burn some back. Anyone else (or any extension wallet) sees the same page read-only.

Stop the stack with `pnpm standalone-down`.

## Workspace layout

| Package | What it is |
|---|---|
| `contract/` | The Compact contract: vendored OpenZeppelin modules (`access/Ownable`, `shielded-token/NativeShieldedToken*`, `utils/Utils`) composed in `modular.compact`, TypeScript witnesses, off-chain owner-commitment helper, simulator unit tests. |
| `node/` | Node-side SDK: wallet building (`@midnightntwrk/wallet-sdk`), providers, deploy scripts per network, docker configs, end-to-end integration tests. |
| `web/` | React frontend: the passkey embedded wallet, owner handshake, and mint/burn UI. See [`web/README.md`](web/README.md). |

## The contract

`contract/src/modular.compact` composes two vendored OpenZeppelin Compact modules (v0.3.0-alpha.1, MIT) behind an authored gate:

- **`Ownable`** — witness-derived identity: owner = `persistentHash(wit_OwnableSK())`. State: `Ownable__owner`, `Ownable__isInitialized`.
- **`NativeShieldedToken`** — single native shielded token; domain separator sealed at construction; MKT metadata (`MintKey Token`, `MKT`, 6 decimals).

Exported circuits (all four require a ZK proof):

| Circuit | Gate | Purpose |
|---|---|---|
| `mint(recipient, amount, nonce)` | owner | Create MKT into a shielded coin (recipient-private). |
| `burn(coin, amount, refundTo)` | owner | Destroy MKT paid in by the caller's wallet. |
| `transferOwnership(newCommitment)` | owner | Rotate the authority to a new passkey's commitment. |
| `tokenColor()` | — | On-chain oracle for the off-chain color derivation (used by tests). |

The composition, the gating, and the passkey→commitment identity flow are authored for MintKey; the privacy building blocks underneath are OZ's. The commitment is computed off-chain by `contract/src/owner.ts` and a unit test asserts it never drifts from the circuit's derivation.

## Security & privacy notes

- **Mint and burn are owner-gated** through `Ownable_assertOnlyOwner()`. This also closes the pre-mint nonce front-running liveness attack that exists for ungated mints.
- The owner secret is **re-derived from the passkey on every connect** and held in memory only. Losing the passkey = losing mint authority (use `transferOwnership` to rotate to a new passkey *before* losing the old one). The wallet seed can be revealed for backup from the Wallet page.
- Mint `amount` is a **public input** (protocol requirement); recipient and nonce stay private inside the coin commitment. Burn publishes no arguments.
- Mint nonces are 32 bytes of CSPRNG output; the coin info returned by mint is the recipient's **only copy** (wallets can't discover contract-minted coins by scanning — the submitting wallet is the execution-verified exception). The app keeps a localStorage record; the nonce is stored in plaintext there, which can de-anonymize the mint recipient if read — encrypt at rest before real use.
- Recipients are restricted to user keys (`ZswapCoinPublicKey`): the contract can never hold coins, so no value can be stranded in it.
- The same secret produces the same commitment across contracts (OZ Ownable's deliberate `msg.sender` analogue). MintKey derives the secret with an app-specific HKDF info tag, so its identity is already domain-separated from other apps.

## Tests

```bash
pnpm -C contract test        # simulator unit tests: token behavior, owner gating,
                             # commitment no-drift, ownership transfer (fast, no docker)
pnpm -C node test-undeployed # full E2E on docker: deploy with commitment → owner mints →
                             # wallet sees shielded balance → burn → non-owner mint rejected
```

Both suites run in CI on every push (`CI` for lint/typecheck/unit tests, `E2E (standalone)` for the docker flow on amd64 **and** arm64 runners), so the standalone claim is demonstrated off the maintainer's machine.

### Troubleshooting the standalone stack

- **`deploy-standalone` and `test-undeployed` share the same fixed host ports (6300 / 8088 / 9944) and the same `modular-*` container names.** Run `pnpm standalone-down` before the tests, and only one test or deploy process at a time — a leftover stack shows up as a port or name collision, not a helpful error.
- **Don't run `pnpm lint` or `pnpm build` while the E2E is running.** Both go through Turbo, whose tasks `dependsOn` `compact`, so they recompile `contract/src/managed/**` — overwriting the ZK keys the running test is reading. It surfaces as `ZKConfigurationReadError: Failed to read verifier key for modular#<circuit>`, which looks like a missing-artifact bug but is just a race. Run them before or after, not alongside.
- **A freshly started stack needs a warm-up before it can transact.** Immediately after `docker compose up`, a deploy can fail with `Insufficient Funds: could not balance dust` even though the wallet reports a large DUST balance. Give the stack a few minutes before running the E2E, or let the tooling wait. A cold machine also pulls ~1.5 GB of images, and the proof server fetches PLONK parameters on first use. `burn` is the largest circuit here, so the first burn is the slowest operation in the suite.
- **If a wait times out**, the message names the indexer URL and prints per-sub-wallet sync state. `connected=false` means the wallet cannot reach the indexer from your host (check the mapped port and your Docker context); connected but a stuck `applied` index means the indexer is not serving the wallet sync stream.
- **Non-default Docker engines** (Colima, Rancher Desktop, OrbStack, a remote `DOCKER_HOST`) are supported — the test harness resolves the container host rather than assuming `127.0.0.1`.

## What MintKey does that midnight-starter-template does not

MintKey is a standalone dApp, not a scaffold: one flow a user actually uses (issue and manage a private token with a passkey), with its own identity. Concretely, beyond the starter template:

1. **The passkey is the on-chain authority.** WebAuthn PRF → HKDF yields *two* domain-separated secrets: the wallet seed *and* an Ownable owner secret whose hash is stored at deploy. No extension wallet offers this — the browser credential itself is the contract-level identity.
2. **Authored privacy work.** Mint and burn are gated by `Ownable_assertOnlyOwner()` — a witness-backed ZK ownership proof — composed and wired by this project (contract, witnesses, node API, deploy handshake, and UI), not inherited from OZ's ungated token module.
3. **A deploy handshake designed around the secret never moving.** The browser shows only the commitment; the deploy script takes the hash and can't mint; the first mint necessarily happens from the owner's browser.
4. **No demo scaffolding.** The counter module and its UI are gone; every page serves the token flow.

## Adding a module

The contract keeps the modular pattern, so extending it is mechanical:

1. Create `contract/src/modules/<feature>/<Feature>.compact` (a `module` with its own state and circuits; track initialization per-module — see the LFDT-Minokawa/compact#270 note in `modular.compact`).
2. Import it in `modular.compact` with a prefix, re-export its ledger state, and wrap the circuits you want public (gate them with `Ownable_assertOnlyOwner()` where appropriate).
3. `pnpm compact`, check `contract-info.json` for ledger collisions, extend the simulator and tests, add node API functions, and surface it in `web/src/modules/midnight/modular-sdk`.

## License

Apache-2.0. Vendored OpenZeppelin Compact modules are MIT (headers preserved).

---

Built by [Edda Labs](https://eddalabs.io)
