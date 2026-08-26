# internal-tools-platform

A shared substrate for a portfolio of internal tools, plus three apps built on it: a KYC
review queue, a refunds dashboard, and a feature-flag admin panel.

The interesting part is not the three apps. It is the layer beneath them: authorization
with deny rules, field-level masking with audited reveal, auditable state transitions,
declarative approval policies, idempotency, and a transactional outbox — built once,
shared by every app, and structurally impossible for an app to bypass.

Setup, architecture, and an honest account of what this does and does not prove are
documented as the substrate lands. Work in progress.
