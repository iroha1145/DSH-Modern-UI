# Experimental web policy — not production ready

This private prototype tests an owned agent preset on official DSH 0.2.1-rc.4. It preserves the `webSearch` projection and `/web` command shape while using supported plugin records and `tools.restrict`.

**Do not install this as a production migration.** The official SDK profile resumes its sessions without the required preset and can execute web tools after `/web off`. The package is intentionally excluded from the production Modern UI bundle. It exists to make the compatibility counterexample reproducible.

See [the release-runtime gate](../../scripts/compatibility/README.md) for the exact tests, evidence boundaries and upstream requirement. Legacy `web/search` logs must remain unchanged and quarantined until a safe official runtime representation is verified.
