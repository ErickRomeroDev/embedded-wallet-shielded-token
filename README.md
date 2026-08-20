# Midnight Modular Starter

A pnpm + turbo monorepo starter for [Midnight](https://midnight.network) DApps built around a single **modular contract**: independent Compact modules (a public counter and a native shielded token) composed into one deployed contract, with a Node SDK layer, real-transaction tests, and a React frontend.

**Live demo:** https://template.preview.eddalabs.io/

## Workspace layout

| Package | Path | What it is |
|---|---|---|
| `@eddalabs/contract` | `contract/` | The Compact contract (`src/modular.compact`) composed from modules under `src/modules/`, plus simulator-based unit tests |
| `@eddalabs/node` | `node/` | Node-side SDK (`src/api.ts`), deploy scripts (`src/deploy/`), and integration tests that run real transactions against a dockerized standalone network |
| `@eddalabs/web` | `web/` | Vite + React frontend (TanStack Router, Lace wallet via the dApp connector) with the contract SDK under `src/modules/midnight/modular-sdk/` |

## The modular contract

`contract/src/modular.compact` composes two modules and exposes their circuits:

- **Counter** (`modules/counter/Counter.compact`) — public round counter; circuit `increment()`, ledger `Counter__round`.
- **Shielded token** (`modules/shielded-token/`, vendored from [OpenZeppelin compact-contracts](https://github.com/OpenZeppelin/compact-contracts) v0.3.0-alpha.1, MIT) — a native shielded (Zswap) token, **EDDA** (`Edda Token`, 6 decimals). Circuits `mint`, `burn`, `tokenColor`; metadata on the public ledger (`ShieldedToken__name` etc.), fixed at deployment by constructor args (see `contract/src/token-metadata.ts`, the single source of truth shared by node and web).

Naming convention: `counter`-named things are specific to the counter module; everything contract-general is `modular`-named.

### Shielded token trade-offs (read before production use)

- **Mint and burn are ungated** — anyone can mint or burn EDDA. That is a deliberate starter simplification and means unlimited public inflation. Before real use, gate the `mint`/`burn` wrapper circuits in `modular.compact` with an access-control module (e.g. OpenZeppelin's `Ownable`).
- **Contract-minted coins are invisible to wallets by scanning** — the coin info returned by `mint` is the recipient's only copy and should be delivered out of band. The verified exception: the *submitting* wallet detects its own minted coins by syncing. The deploy flow relies on this (mint to the genesis wallet, then a normal wallet-to-wallet shielded transfer, which recipients *can* detect); the web app additionally records minted coins in localStorage.
- The token color is `tokenType(domain, contractAddress)` — derived off-chain everywhere via `rawTokenType` (execution-verified to match the `tokenColor` circuit).

## Getting started

```bash
pnpm install
pnpm compact          # compile the contract (turbo)
pnpm build            # build all packages
```

### Standalone network: deploy + fund your wallet

1. Copy `node/.env_template` to `node/.env` and fill in both addresses from your Lace wallet:
   - `MY_UNDEPLOYED_UNSHIELDED_ADDRESS` (`mn_addr_undeployed1...`) — receives tNight
   - `MY_UNDEPLOYED_SHIELDED_ADDRESS` (`mn_shield-addr_undeployed1...`) — receives EDDA
2. Run:

```bash
cd node
pnpm deploy-standalone
```

This starts the docker stack (`standalone.yml`), deploys the contract, funds your wallet with tNight **and** 1000 EDDA (mint → wallet shielded transfer), and writes `node/deployments/undeployed.json`. The stack keeps running; stop it with `pnpm standalone-down`.

3. Point the web app at the deployment:

```bash
cd web
echo "VITE_CONTRACT_ADDRESS=<contractAddress from deployments/undeployed.json>" > .env
pnpm build   # copies proof keys/zkir into public/midnight/modular
pnpm dev
```

Connect your wallet (undeployed network), then use the **Counter** page to increment and the **Tokens** page to mint/burn EDDA.

## Wallets

The app offers two connection options in the wallet dialog:

- **Extension wallets** (Lace, etc.) via the Midnight dApp connector.
- **Passkey Wallet** — an embedded wallet whose HD seed is derived from a WebAuthn passkey (PRF extension). No extension needed; the seed/keys/addresses are all computed from the passkey. Needs a platform authenticator with PRF support (Touch ID / Windows Hello / recent Android / PRF-capable security key) and a secure context (`localhost` is fine). Lives in `web/src/modules/midnight/embedded-wallet/`.

The passkey seed is bound to the authenticator — if the passkey is lost and wasn't synced (iCloud/Google), the wallet is unrecoverable. The wallet dashboard (`/wallet-ui`) has a **Reveal seed (backup)** action (behind a fresh passkey confirmation) to save the seed. Proving still uses the local proof server (`127.0.0.1:6300`); in-browser proving is not enabled.

**Funding the embedded wallet on standalone:** unlike Lace, the embedded wallet has its own addresses. Connect via Passkey first, copy its **Unshielded** and **Shielded** addresses from `/wallet-ui`, put them into `node/.env` (`MY_UNDEPLOYED_UNSHIELDED_ADDRESS` / `MY_UNDEPLOYED_SHIELDED_ADDRESS`), then run `pnpm deploy-standalone`. NIGHT is auto-registered for DUST generation on connect once it arrives (there's also a manual **Register for DUST** button).

## Tests

```bash
pnpm --filter @eddalabs/contract test      # simulator unit tests (counter + shielded token)
pnpm --filter @eddalabs/node test-undeployed  # real transactions vs docker: deploy, increment, mint, burn
```

The node tests use the same docker services as `deploy-standalone` — run `pnpm standalone-down` first if a stack is up.

## Adding a module

1. Create `contract/src/modules/<feature>/<Feature>.compact` (a `module` with its own ledger state and circuits).
2. Import it in `modular.compact` with a prefix, re-export its ledger state, and wrap the circuits you want public.
3. Recompile (`pnpm compact`), extend the simulator + tests, add node API functions, and surface it in `web/src/modules/midnight/modular-sdk`.
