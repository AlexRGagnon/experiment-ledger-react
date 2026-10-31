# Local validation

Recorded UTC: 2026-10-31T01:41:10.991057+00:00

Windows 11 x64; Node.js 22.15.1; npm 10.9.2; React/React DOM 19.3.1; TypeScript 5.8.3; Vite 8.3.5; Playwright 1.64.1; Microsoft Edge 156.0.4314.56 (headless). Exact dependency versions are pinned in the lockfile.

## Results

- Strict TypeScript server/client compilation and Vite production build: passed.
- **12/12 Node unit/integration tests passed**, using real SQLite files and real local HTTP servers.
- **9/9 Playwright browser tests passed**, using the compiled UI and actual API/database, not mocked success responses.
- The sole response mock deliberately injects an API failure to verify error display and recovery.
- Browser checks include keyboard import, canonical deduplication, invalid-input feedback, two-run metric comparison, JSON download, note persistence across reload, stale-write conflict recovery without losing the draft, literal rendering of HTML-like input, filtering, and a 375-pixel viewport without page-level horizontal overflow.
- The comparison/export browser test observed no requests to external services.
- API checks reject cross-origin requests, hostile Host headers, missing write guards, malformed JSON, wrong media types, oversized bodies, and arbitrary source-file requests.
- SQLite note update/readback is transactional; optimistic versions prevent silent overwrites. Duplicate imports retain existing notes. Search results explicitly report truncation above 200 matches.
- The generated `examples/workbench.png` was visually inspected; the displayed records are synthetic.

## Reproduce

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run format:check
npm test
npm run test:browser
```

Tests run on the local computer. Browser tests start their own server on port 8797 with a new test database, do not reuse a running server, and do not touch a normal browser profile. The current Windows default is installed Edge; see README for other browser setups.

## Boundaries

This is a local single-user workbench, not an authenticated Internet service. No penetration-test certification, full accessibility certification, screen-reader review, power-loss durability certification, load/capacity benchmark, or cross-platform browser matrix is claimed. Node's SQLite API is experimental in the tested release. No GitHub Actions, paid services, remote database, or hosted compute.
