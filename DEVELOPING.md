# Developing the DCF calculator

[README.md](README.md) is the guide for people using the calculator. This file is for whoever changes it next.

**Current version:** calculator 1.4.0, Claude connector 1.0.0.

## Layout

```
index.html            the calculator as one file, built by build.mjs (commit it: the README links to it)
src/app.html          the calculator's source: styles, page and script, without <html>/<head>
                      (that is also how it's published inside claude.ai)
src/dcf-core.js       the fields, number reading and valuation maths, with no page code.
                      Pasted into the page at /*@DCF_CORE@*/ and bundled into the connector,
                      so both give the same numbers
connector/src/        the Claude connector: a remote MCP server for Cloudflare Workers
  worker.js           routing, OAuth 2.1 (dynamic client registration, client ID metadata
                      documents, PKCE), MCP JSON-RPC at /mcp, the CONFIG markers
  tools.js            get-overview, get-valuation, run-dcf, save-valuation, delete-valuations
  firebase.js         Firebase Auth + Firestore REST client for one user (users/{uid}/dcf/{id})
  seal.js             AES-GCM sealed tokens, PKCE, HMAC (the Worker keeps no data)
  pages.js            the sign-in page and the "it's running" page, English and Chinese
build.mjs             builds index.html, dist/artifact.html, dist/dcf-calculator-v<version>.html
                      and dist/dcf-connector-v<version>.js
test/                 fake-google.cjs (stand-in Firebase Auth + Firestore), connector.mjs,
                      sync.cjs, same-numbers.cjs, run-all.sh
docs/                 pictures used by the README
```

The connector is adapted from [Checkmate](https://github.com/TymonBitesTheDust/Checkmate)'s
(`connector/`): same OAuth design, token sealing and Firebase client, with its own tools,
its own token prefixes (`dca_`, `dcr_`, `dcc_`, `dcq_`) and its own collection.

## How the pieces fit

- **Saves** are version 2 snapshots: `{ v: 2, ticker, name, savedAtMs, savedAt, inputs, scenarios, result }`,
  made by `DCF.snapshot(st)`. A save from Claude also has `by: 'claude'` and may have `asOf` and `note`.
- **Sync** (downloaded calculator only; hidden inside claude.ai, which keeps its own history) talks to
  the user's Firebase project over REST with no SDK: `users/{uid}/dcf/{id}`, each document stamped with
  `srv` = the server's write time. The page pushes its queued changes (`dcf-sync-v1.pending` in
  localStorage), then pulls everything with `srv` later than the last one it saw, every 15 seconds while
  visible and whenever it becomes visible. Deletes are written as `{ deleted: true }` so other devices see
  them. Checkmate's rules (`match /users/{uid}/{document=**}`) already allow this collection, so one
  Firebase project and account can serve both apps; the calculator also accepts Checkmate's `TW1-` setup codes.
- **The connector record** `users/{uid}/dcf/claude` = `{ type: 'connector', secret, gen, url, authAt, authEmail }`.
  The page creates it after the first successful sync (so two devices don't make two), writes only the
  fields it changes (`updateMask`), and puts `secret` into the connector code it hands out between
  `/*DCF_CONFIG*/` and `/*END_DCF_CONFIG*/`. Every tool call checks that `gen` still matches the token's,
  so **Disconnect** (a new `gen`) cuts Claude off at once. The sign-in page refuses accounts without the record.
- **Ask Claude in the downloaded page** has two routes (`ai.route`, kept in `dcf-ai-route-v1`). **Your Claude plan**
  (the default) builds a prompt (`aiPlanPrompt`) and opens `https://claude.ai/new?q=…` in a new tab, copying the prompt
  too (the web `q` prefill isn't officially documented) and offering the documented desktop link `claude://claude.ai/new?q=…`.
  When the connector is connected, the prompt asks Claude to use `run-dcf` and `save-valuation`, and sync brings the save back.
  Without it (no Firebase or Cloudflare needed), Build and Update use `aiDraftPrompt(mode, tk, true)`, which asks Claude to end its
  reply with the same JSON the API-key route gets, in a code block; the viewer pastes it into **Paste Claude's answer**
  (`aiPasteApply`, read with `parseLooseJson`), and it goes through `aiBuildApply` or `aiMakeProposal` like an API answer.
  A Claude plan can't be used by the page itself: Anthropic doesn't permit other apps to route requests through
  Free, Pro or Max credentials. **API key** is the 1.1.0 behaviour (the viewer's own Anthropic API key, billed separately).
  Inside claude.ai the panel uses the viewer's account through `sample`, as before.
- **Tools** read the user's whole `dcf` collection once per call (a few documents per stock), turn Claude's
  numbers into the same text the boxes would hold (`DCF.fmtInput`), and evaluate with the core. `startFrom:
  "latest"` loads the newest save with `DCF.fromSnapshot` and changes only what Claude passes.

## Building and testing

Node 18 or newer. `npm install` gets esbuild. The browser tests need Playwright with Chromium.

```bash
npm install
node build.mjs
sh test/run-all.sh
```

- `test/connector.mjs` runs the built connector's `fetch` handler against the stand-in Google APIs:
  OAuth sign-in, every tool (including the Vistra numbers the calculator's own Claude test uses), refresh and Disconnect.
- `test/sync.cjs` drives two browser "devices": create account, upload earlier saves, connector code from
  Save as file, Check (a Hello World Worker, then the real one), a valuation saved through the connector
  appearing with a toast, a second device using the setup code, a delete reaching the other device and
  Claude, Disconnect, Chinese and phone width. `SHOTS=dir` saves screenshots (`docs/sync-claude.png` comes from here).
- `test/same-numbers.cjs old.html new.html` loads the same saves into two builds and compares every
  number on screen. Run it against the previous release after touching `src/dcf-core.js`.

## Releasing

1. Bump `APP_VERSION` in `src/app.html` (and `VERSION` in `connector/src/worker.js` when the connector
   changes: the page warns people running an older connector to copy the code again).
2. Add the version to the README's version history, in plain words.
3. `node build.mjs && sh test/run-all.sh`, then commit `index.html` with the sources.
4. Create a GitHub release named after the version and attach `dist/dcf-calculator-v<version>.html`.
5. For claude.ai, publish `dist/artifact.html` over the existing artifact.
