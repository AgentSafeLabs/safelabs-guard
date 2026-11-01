# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately by email to waqar@agentsafelabs.io. Please do not open a public issue for a vulnerability.

Include:

* The affected route or component.
* Steps to reproduce.
* The impact.
* Any test media (images or audio) needed to reproduce it.

## What to expect

We will acknowledge reports on a best-effort basis. There is no fixed response time.

## Scope

In scope:

* This repository.
* https://guard.agentsafelabs.com/live and its API routes.

Out of scope:

* Denial of service by volume or spam against the demo.
* Findings that depend on the demo's mock mode (`SAFELABS_USE_MOCKS=true`).
* Third-party Meta services.

## Existing automated checks

[docs/REQUEST-HARDENING.md](docs/REQUEST-HARDENING.md) describes the request-level limits and scripted abuse test already in place. These are automated checks, not a security audit or a penetration test.
