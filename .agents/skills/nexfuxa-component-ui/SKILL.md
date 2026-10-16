---
name: nexfuxa-component-ui
description: Create, modify, review, or validate NexFuxa industrial HMI Components, Symbols, Faceplates, PLC bindings, status animations, and configuration UIs using the frozen Component UI Design System. Use for Valve Symbols, Motor Faceplates, PLC-structure-based Components, and component status/configuration changes. Do not use for unrelated ordinary code, Git, Docker, or PLC logic work.
---

# NexFuxa Component UI

Use this workflow for Component UI work in this repository. This skill provides process; the linked specifications remain the sole design authority. Resolve links relative to this SKILL.md, then work from the repository root. Do not interpret the frozen design as implemented runtime support.

1. Classify the request as Symbol, Faceplate, full Component generation, or existing Component maintenance. Read the small [specification index](../../../docs/component-ui/README.md). State scope and assumptions; inspect Git status and applicable instructions before editing.
2. Load only the documents needed by that task:

   | Task | Read next |
   | --- | --- |
   | Valve or other Symbol | [SYMBOL](../../../docs/component-ui/SYMBOL.md); [STYLE](../../../docs/component-ui/STYLE_GUIDE.md) and [Tokens](../../../docs/component-ui/tokens.json) for visual changes |
   | Motor or other Faceplate | [FACEPLATE](../../../docs/component-ui/FACEPLATE.md) and [CONTRACT](../../../docs/component-ui/CONTRACT.md); STYLE/Tokens only for presentation |
   | Full Component / PLC structure generation | CONTRACT, [types](../../../docs/component-ui/contract.ts), then the requested Symbol/Faceplate spec |
   | Existing status, binding, command or configuration change | CONTRACT plus only the affected presentation spec; types when schema is relevant |

   Do not bulk-read all documents/assets/fixtures. Unrelated ordinary code tasks do not need this skill or the full Component UI specifications.
3. Read the actual PLC DUT/FB, current Component Model, saved project naming and existing Component code relevant to the request. Record verified members/types and unsupported or unknown capabilities. The [Valve example](../../../docs/component-ui/examples/valve.json) is specific to Valve: never substitute it for a Motor model. If a requested model is absent, locate the real model or ask for the missing source before inventing behavior. Never fabricate PLC fields, commands, alarm lifecycle, permissions or online evidence.
4. For new/replaced equipment geometry, follow [SVG_REUSE_POLICY](../../../docs/SVG_REUSE_POLICY.md), search FUXA-SVG-Widgets first, and inspect permitted assets. Keep the selected Valve25 for Valve; do not reopen built-in Shape comparisons. Preserve recognizable geometry/license and record provenance. Do not modify the source library.
5. Apply the finite shared state profile and current Contract. Reuse Widget/Faceplate, exact Prefix/Inherit resolution, instance Context, owner subscriptions and existing permissions. Inspect the implementation before claiming a capability exists. Do not bypass old guards, create/rename Tags or invent a second mapping/ID system. Ordinary Component work must not change the frozen global Contract; a required semantic change needs an explicit versioned specification change.
6. Generate or modify only necessary, authorized files. Use representative [assets and provenance](../../../docs/component-ui/assets/PROVENANCE.md) as visual references, not executable templates. Keep command/configuration writes and live PLC feedback separate. Respect the Contract command no-Restore/no-buffer/no-retry boundary, including the existing server restore path; if missing runtime support blocks delivery, report it instead of claiming it is present.
7. Validate applicable cases: geometry/license, three layout definitions, state/data-quality dimensions, permissions/invalid binding, exact targets, Widget/View ID and selector isolation, independent animations and destroy cleanup, multi-window subscription ownership, reduced motion, old Manual/Fixed/Inherit compatibility, and save/export/import when changed. For Valve state work use [complete vectors](../../../docs/component-ui/fixtures/valve-states.json) and [partial vectors](../../../docs/component-ui/fixtures/valve-partial-data.json); for instance work use [multi-instance inputs](../../../docs/component-ui/examples/valve-instances.json). Keep expectations separate from executed runtime tests.
8. Run checks appropriate to the diff, including actual JSON/type consistency and SVG parsing when affected. Existing entry points include `node --test client/test/widget-prefix-binding.test.cjs client/test/faceplate-binding.test.cjs client/test/view-instance.test.cjs custom/widgets/valves/NexPlc_Valve.test.cjs`. Follow existing test setup; do not write to real PLCs or production data without task authorization.
9. Report changed files, checks actually executed, behavior delivered, backward compatibility, and pending runtime/field validation. Do not push, merge, deploy or begin another phase unless authorized by the current task.
