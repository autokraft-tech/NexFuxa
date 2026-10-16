# SVG asset reuse

For every new or replacement HMI graphical widget, search `D:\Will\Documents\source\repos\FUXA-SVG-Widgets` first; prioritize `Proc. Engineering\Proc. Eng. Valves` for valves. Compare suitable candidates by appearance, equipment type, and function, then copy a permitted asset into `custom/widgets` and adapt it while preserving its recognizable geometry. Never modify the source library or redraw an equivalent industrial symbol for convenience.

Follow [docs/SVG_REUSE_POLICY.md](docs/SVG_REUSE_POLICY.md) for license review, provenance, PLC profile binding, rendering, runtime update, and multiple-instance checks. If no suitable, permitted asset is available, report the search and alternatives and obtain explicit user approval before creating an original SVG.

# Git workflow

- `origin` is `https://github.com/autokraft-tech/NexFuxa.git`; `upstream` is `https://github.com/frangoteam/FUXA.git`.
- `master` is reserved for official upstream synchronization. Never commit NexFuxa custom features there.
- `nexfuxa` is the main customization branch and GitHub default branch.
- Create all feature branches from the current `nexfuxa`; merge completed features into `nexfuxa` through reviewed, tested PRs.
- Synchronize official updates into `master` using fast-forward only. Stop on divergence; do not overwrite either branch.
- Integrate official changes into `nexfuxa` through a separate, tested integration PR.
- Never force-reset `nexfuxa` to upstream or rewrite published shared-branch history. Do not force-push.
- Keep production and development Docker data, databases, logs, and backups out of Git; preserve `.local/fuxa-dev` and existing runtime volumes.

See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) for synchronization, conflict resolution, and releases.

# Component UI

For Component, Symbol, or Faceplate generation/modification, use the [nexfuxa-component-ui skill](.agents/skills/nexfuxa-component-ui/SKILL.md) and read only the relevant authoritative specifications in [docs/component-ui/](docs/component-ui/README.md). Prioritize FUXA-SVG-Widgets under the existing [SVG reuse policy](docs/SVG_REUSE_POLICY.md). Preserve Prefix/Inherit binding, multiple-instance isolation, and command no-Restore/no-replay restrictions. Do not change the frozen UI Contract during ordinary component development; semantic changes require an explicit versioned specification change.
