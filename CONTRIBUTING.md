# Contributing to Safelabs Guard

## Setup

```bash
git clone https://github.com/AgentSafeLabs/safelabs-guard.git
cd safelabs-guard
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 for the home page, http://localhost:3000/live for the live agent and http://localhost:3000/scenarios for the mock-perception scenarios.

`.env.example` sets `SAFELABS_USE_MOCKS=true`: explicit mock mode, for local demos only. Mock perception assumes every frame shows the expected items, so any valid image is allowed on `/live`. Set it to `false` and add the three Meta keys for live mode. With it unset and no keys, `/live` loads but guarded turns fail closed with BLOCK. Never commit `.env.local` or API keys.

## Tests and checks

```bash
npm test                # unit tests (vitest)
npm run lint            # next lint
npm run typecheck       # tsc --noEmit
npm run benchmark       # ASI-MM mock regression suite (30 cases)
npm run bench:replay    # recorded-response benchmark report (bench/, 40 cases)
```

Run `npm test`, `npm run lint` and `npm run typecheck` before opening a pull request.

## Proposing a change

Open an issue first for any change to guard logic (`lib/guard/`), detectors, prompts or the voice allowlist. Other changes can go straight to a pull request.

## The benchmark rule

Changes to detectors, prompts or the voice allowlist must not be tuned on the held-out benchmark cases. Any change motivated by those cases must be reported as post-hoc.

## The fail-closed rule

Guard fails closed on any doubt. Changes must not loosen fail-closed behaviour without discussion in an issue first.

## Licence

Contributions are accepted under the Apache-2.0 licence (see [LICENSE](LICENSE)).

## Reporting vulnerabilities

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
