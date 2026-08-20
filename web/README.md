# `@eddalabs/web`

The React + Vite frontend for [MintKey](../README.md) — the browser is where MintKey actually lives: the passkey (WebAuthn PRF) embedded wallet, the owner-commitment handshake, and the owner-gated mint/burn flow all run here. It also supports extension wallets (read-only for owner actions) against any Midnight network (standalone, Preview, Preprod).

> 💡 Most setup steps live in the **[root README](../README.md)**. This file documents what's specific to the frontend package.

## Stack

- React 19 + TypeScript
- Vite 6
- TanStack Router
- Tailwind CSS v4 + Radix UI
- pino for structured logging
- Midnight `dapp-connector-api` + `midnight-js-*` SDKs + `@midnightntwrk/wallet-sdk` (in-browser wallet)

## Local development

From the **project root** (recommended — Turbo will compile the contract and copy keys):

```bash
pnpm install
pnpm build
pnpm dev:frontend
```

Or from this directory:

```bash
pnpm dev      # Vite dev server
pnpm build    # Copies contract keys + bundles for production
pnpm preview  # Preview a production build
pnpm lint     # ESLint
```

## Environment

Create `.env` from [`.env_template`](./.env_template):

| Variable | Description |
|---|---|
| `VITE_CONTRACT_ADDRESS` | Address of the deployed MintKey contract to join (required — the app is join-only). Copy it from `node/deployments/<network>.json` after running `pnpm deploy-standalone`. |

Before a contract exists, the app renders a bootstrap page that derives your **owner commitment** from your passkey — set it as `OWNER_COMMITMENT` in `node/.env` for the deploy (see the root README's Getting Started).

## Project layout

```
src/
├── App.tsx              # Application shell
├── main.tsx             # Vite entrypoint
├── routes/              # TanStack Router route tree
├── pages/               # Page-level components (home, tokens, wallet-ui)
├── components/          # Shared UI (theme provider, mode toggle, ui/*)
├── modules/midnight/    # Embedded wallet + wallet widget + modular-sdk hooks/contexts
├── layouts/             # Layout wrappers
├── lib/                 # Utilities
└── globals.ts           # Network/runtime globals
```

Key modules:

- `modules/midnight/embedded-wallet/` — the passkey wallet: WebAuthn PRF → HKDF derivations (wallet seed and Ownable owner secret), in-browser `WalletFacade`, dApp-connector adapter.
- `modules/midnight/modular-sdk/` — contract layer: joins the deployed contract with real witnesses (`wit_OwnableSK`), derives `isOwner` by comparing the passkey commitment with the on-chain owner, exposes `mint`/`burn`.

The compiled contract artifacts are copied into `public/midnight/modular/{keys,zkir}` by `pnpm copy-contract-keys` (run automatically as part of `pnpm build`). They are gitignored — run a build before deploying.
