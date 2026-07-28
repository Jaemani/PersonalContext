# Setup UI

Reusable React setup wizard for Personal Context. Import `SetupWizard` and
`setup-wizard.css`, then pass a `SetupApiClient` that implements `detect()` and
`connect()` against the application's same-origin routes.

The included `sameOriginSetupClient` expects:

- `GET /api/setup/detect` → `SetupDetection`
- `POST /api/setup/connect` with `SetupOptions` → `SetupResult`

`onChooseFolder` is intentionally host-provided because browser code cannot
reliably access the local filesystem without a desktop/native bridge.
