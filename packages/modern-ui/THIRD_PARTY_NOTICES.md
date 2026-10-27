# Third-party notices

## DeepSeek Harness

The retained React presentation components, styles, dictionaries, selected UI owners, model-card schema, and explicit Host compatibility modules derive from DeepSeek Harness, Copyright (c) 2026 DeepSeek, under MIT. The source revision and Modern UI patch revision, per-file source/adaptation digests, and language-data origins are recorded in [provenance.json](provenance.json). The retained source locations are `src/vendor/{primitives,chat,model,intelligent,theme,attachment,subagent,translation,tool,layout,conversation,sidebar,workspace,settings-shell}` and `src/host-compat` in this repository; the npm distribution contains their compiled JavaScript. Translation presentation and its cancellation/cache controller derive from `packages/experimental/client-ui-cot-translation`; the original optional Host/Remote service remains external. Steering-batch presentation adapts the patched ui-chat inbox/turn-process definitions and ChatView styles; Schedule presentation adapts the patched ui-schedule card styles. Their source hashes are recorded with the adapters.

The complete license is retained in [LICENSE](LICENSE) and [licenses/DeepSeek-Harness-host.txt](licenses/DeepSeek-Harness-host.txt). The official backend, session/remote/command/model-directory services, React, React DOM and Cordis are supplied by the consuming Host and are not copied into the browser artifact. These notices do not claim that the migration is functionally complete.

## OpenIntelligentUI and Lucide

The HTML visualization parser, frame design system and native nested sandbox renderer in `src/vendor/intelligent/client` adapt the completed-content presentation approach of CopilotKit/OpenIntelligentUI. The reviewed revision and original paths are recorded in [open-intelligent-ui-upstream.json](open-intelligent-ui-upstream.json). OpenIntelligentUI is Copyright (c) Atai Barkai, under MIT; see [licenses/OpenIntelligentUI-MIT.txt](licenses/OpenIntelligentUI-MIT.txt).

The renderer contains a subset of geometry from `lucide-static` 1.52.0. Lucide is Copyright (c) 2026 Lucide Icons and Contributors, under ISC; Feather-derived icons are Copyright (c) 2013-present Cole Bemis, under MIT. Both notices are retained in [licenses/Lucide-ISC.txt](licenses/Lucide-ISC.txt). No CopilotKit runtime, upstream Python backend, Next.js, JetBrains Websandbox or host-capability RPC bridge is distributed here.

## Vendor marks and Simple Icons

The 21 monochrome model-vendor marks in `src/vendor/model/client/vendor-marks.ts` derive from `@lobehub/icons-static-svg` 1.98.0. Lobe Icons is Copyright (c) 2023 LobeHub, under MIT; see [licenses/LobeIcons-MIT.txt](licenses/LobeIcons-MIT.txt) and [vendor-marks-upstream.json](vendor-marks-upstream.json). Vendor names and marks remain trademarks of their respective owners and identify the provider of a model.

The pure icon primitives also contain `simple-icons` 16.31.0 data under CC0-1.0. Its complete text is retained in [licenses/npm/simple-icons16.31.0.txt](licenses/npm/simple-icons16.31.0.txt).

## Markdown, highlighting, math and other bundled libraries

The browser build embeds Shiki 4.5.0 and its selected grammars and JavaScript regex engine, KaTeX 0.18.10 JavaScript/CSS/font assets, the micromark/mdast Markdown packages, and small presentation utilities including clsx, anser and diff. Font files referenced by the packaged KaTeX CSS are embedded as data URLs; they do not reference the developer checkout or an external CDN. The installed KaTeX package's MIT license is retained with its assets in the license collection. The `diff` library is BSD-3-Clause; the remaining declarations are recorded per dependency rather than inferred from this summary.

The build collects the actual browser input packages, exact installed versions, declared licenses and their shipped LICENSE/COPYING/NOTICE texts in [licenses/bundled-dependencies.json](licenses/bundled-dependencies.json) and `licenses/npm/`. This includes transitive parsing, Unicode and highlighting dependencies. DeepSeek utility libraries use the retained DeepSeek MIT notice when their npm package omits a standalone license file.

The data preflight entry embeds fflate 0.8.3 under MIT; see [licenses/fflate.txt](licenses/fflate.txt). The MCP compatibility entry consumes `@modelcontextprotocol/client` 2.3.0 as a normal npm dependency; its package and license remain in the consumer's dependency installation. Shared official DSH services and the official TranslationError class remain external. TypeScript, esbuild, lightningcss and the browser-test driver are development tools and are not included as consumer-side build dependencies.

