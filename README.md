# Vangard Research Studio

A desktop workspace for visual-novel writers to collect story research and keep their worldbuilding
consistent: documents, images, audio, web clips, maps and chat transcripts, plus a story bible with
route-scoped canon and conflict detection.

AI features are optional and stay off until you enable them and provide your own API key.

## Development

Requires Node.js 22+.

```bash
npm install
npm run electron:start   # build and launch the app
npm test                 # unit tests
npm run test:e2e         # end-to-end tests against the real Electron app
npm run gate             # everything (typecheck, lint, unit, e2e)
```
