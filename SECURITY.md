# Security policy

## Supported version

Only the latest beta release is supported.

## Important boundaries

Digital Servant is designed for local use and binds to `127.0.0.1`. Do not change it to `0.0.0.0`, forward its ports, or expose it through a tunnel without adding proper authentication and reviewing the threat model.

The app generates local secrets in `data/`. Do not commit or share that folder. Provider credentials remain managed by OpenCode, but approved tools can still read or change files within their permitted scope.

## Reporting a vulnerability

Open a private GitHub security advisory for this repository. Do not put credentials, access tokens, private prompts, or a working exploit against another person's machine in a public issue.
