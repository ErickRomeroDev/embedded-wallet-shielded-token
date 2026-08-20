# `@eddalabs/web`

The React + Vite frontend for the [Midnight Starter Template](../README.md). It connects to the Lace wallet, talks to the deployed Modular contract, and demonstrates the dApp Connector flow against any Midnight network (standalone, Preview, Preprod, Mainnet).

> 💡 Most setup steps live in the **[root README](../README.md)**. This file documents what's specific to the frontend package.

## Stack

- React 19 + TypeScript
- Vite 6
- TanStack Router
- Tailwind CSS v4 + Radix UI
- pino for structured logging
- Midnight `dapp-connector-api` + `midnight-js-*` SDKs

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
| `VITE_CONTRACT_ADDRESS` | Address of the deployed Modular contract to join (required — the app is join-only). Copy it from `node/deployments/<network>.json` after running `pnpm deploy-standalone`. |

## Project layout

```
src/
├── App.tsx              # Application shell
├── main.tsx             # Vite entrypoint
├── routes/              # TanStack Router route tree
├── pages/               # Page-level components (home, counter, tokens, wallet-ui)
├── components/          # Shared UI (theme provider, mode toggle, ui/*)
├── modules/midnight/    # Wallet widget + modular-sdk hooks/contexts
├── layouts/             # Layout wrappers
├── lib/                 # Utilities
└── globals.ts           # Network/runtime globals
```

The compiled contract artifacts are copied into `public/midnight/modular/{keys,zkir}` by `pnpm copy-contract-keys` (run automatically as part of `pnpm build`). They are gitignored — run a build before deploying.

## Deployment

Production deployment to Vercel is documented in [`DEPLOYMENT_PROCEDURE.md`](../DEPLOYMENT_PROCEDURE.md). Git LFS must be enabled in Vercel for the contract verifier/prover keys to be served correctly.
