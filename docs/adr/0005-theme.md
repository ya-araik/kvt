# ADR-0005: Neutral theme architecture

Status: accepted

Theme contracts are renderer-independent immutable TypeScript values. Semantic
colors, typography, shapes, spacing, motion and elevation are the only built-in
domains. Product layouts and feature-specific tokens are not framework API.

Generated CSS variables are prefixed `--kvt-` and applied only to an explicit
Element or ShadowRoot target. No package import changes `html`, `body`, global
classes or the document color scheme. React and Tailwind integrations live in
separate packages.

