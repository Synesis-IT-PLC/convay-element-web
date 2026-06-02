# Convay fork → element-web v1.12.20 sync report

**Branch:** `develop-v2` **Base:** upstream `v1.12.20` (element-hq/element-web, tagged 2026-05-27)
**Previous fork base:** upstream `develop` @ `c91a24f17b` (2026-01-18)

## Why this wasn't a normal merge

Between our fork point and v1.12.20 (~4,626 upstream commits), element-web did a **full
monorepo restructure**, so a `git merge` would have produced hundreds of modify/delete
conflicts and a duplicated source tree. Instead we reset `develop-v2` to pristine v1.12.20
and **ported the fork's 56-file change set** onto the new layout.

Structural changes absorbed:

- `src/` → `apps/web/src/`, `res/` → `apps/web/res/`, root config → `apps/web/`.
  Also `apps/desktop`, `packages/{shared-components,module-api,…}`.
- **yarn → pnpm** workspace (`pnpm-lock.yaml`, `packageManager: pnpm@10.33.3`), **Nx** task runner.
- **React 18 → 19**, **TypeScript → 6.0**. Web app still webpack+jest; shared packages use vite/vitest.
- Build toolchain now requires **Node ≥ 22.18** (we use v24.12.0 locally).

## How the port was applied

`git diff c91a24f17b <old-develop-HEAD>` split into two patches and applied with `git apply --3way`:

- `src/` + `res/` + `config-*.json` → `--directory=apps/web` (uniform prefix remap).
- `packages/shared-components/...` → applied as-is (that dir already existed at fork point).

45 files applied cleanly via 3-way; 6 needed manual conflict resolution; 4 were
relocated/removed upstream and handled by decision (below).

## Manual conflict resolutions (re-implemented intent)

| File                                                                           | Upstream change                                                                                                       | Resolution                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/vector/url_utils.ts`                                             | URL parsing fully rewritten (`parseQsFromFragment` returns `URLSearchParams`; new `urlParameterConfig`/`parseAppUrl`) | Re-implemented JWT extraction (`#/jwt=<token>` → `jwt` param) inside the new `parseQsFromFragment`; added a `jwt` group to `urlParameterConfig` so it surfaces as `urlParams.jwt.jwt`.                                                                                                                                     |
| `apps/web/src/Lifecycle.ts`                                                    | `loadSession` now reads structured `opts.urlParams`, not `fragmentQueryParams`                                        | Re-pointed JWT login to `urlParams?.jwt?.jwt`. **Switched config reads from a static `import ../config.json` to `SdkConfig.get(...)`** (the static import targets a gitignored file and breaks clean builds). Dropped unused email/password fragment fallbacks (`validateJwtViaApi` ignored them). Removed `console.log`s. |
| `apps/web/src/IConfigOptions.ts`                                               | n/a                                                                                                                   | Added `jwt_validate_url` and `jwt_failure_redirect_url` keys (needed now that JWT config is read via typed `SdkConfig.get`).                                                                                                                                                                                               |
| `apps/web/src/components/views/auth/Welcome.tsx`                               | `welcome.html` replaced by React `<DefaultWelcome />`                                                                 | Took upstream version. **Dropped** the fork's `welcome.html` + `$signInUrl`/`$signUpUrl` replaceMap. The Convay auth redirect is still enforced earlier in `index.ts` via `auth_pages_redirect_url` (ported cleanly). ⚠️ See "needs your decision".                                                                        |
| `apps/web/src/components/views/settings/tabs/user/SecurityUserSettingsTab.tsx` | Privacy section refactored into a conditional `privacySection` local                                                  | Kept the fork's intent (encryption section commented out, privacy section always shown with `DiscoverySettings`); removed the now-unused `privacySection`/`discoverySection` locals.                                                                                                                                       |
| `apps/web/src/i18n/strings/en_EN.json`                                         | Flat `welcome_to_element` key replaced by a `welcome{}` object                                                        | Took upstream's `welcome{}`. Convay branding now comes from the `brand` config value via `title_generic: "Welcome to %(brand)s"` rather than a hardcoded string.                                                                                                                                                           |
| `packages/shared-components/.../RoomListSearchView.test.tsx`                   | Test migrated jest → vitest (`vi.fn()`)                                                                               | Kept `vi.fn()`, added the fork's `onSettingsClick = vi.fn()`.                                                                                                                                                                                                                                                              |

## Relocated / removed upstream — handled by decision

The fork's CMJ-77 "show ongoing call in room list" touched files upstream moved across package
boundaries. **Upstream now implements this feature natively**: the new `NotificationDecoration`
component renders a video/voice call icon from `notification.callType`, which the room-list
viewmodel computes for group/Element calls. We therefore adopted upstream's implementation and
did **not** port the fork's versions:

| Fork file                                                     | Decision                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `RoomListItemViewModel.tsx` (`isInCall`/effective `callType`) | Dropped — upstream viewmodel computes `callType` for group/Element calls. |
| `RoomListItemView.tsx` (icon next to room name)               | Dropped — upstream `NotificationDecoration` renders the call icon.        |
| `res/css/.../_RoomListItemView.pcss`                          | Dropped — the `.mx_RoomListItemView_callIcon` style is unreferenced.      |
| `res/welcome.html`                                            | Dropped — replaced by React `DefaultWelcome`.                             |

**Difference vs the fork:** the fork additionally detected **legacy 1:1 calls** (`LegacyCallHandler`),
which upstream's indicator does not cover (it tracks group/Element-Call participants only). Since
Convay uses Element Call, this is likely immaterial — but if legacy-1:1 indication is still wanted,
it must be re-added by extending `RoomListItemViewSnapshot` (in `packages/shared-components`) and the
`apps/web` `RoomListItemViewModel`.

## ⚠️ Needs your decision

- **Welcome page sign-in/sign-up links:** the fork pointed these at Convay (`auth_signin_url`/
  `auth_signup_url`) inside the now-removed `welcome.html`. We rely on the `index.ts`
  `auth_pages_redirect_url` redirect instead. If you want the buttons on `DefaultWelcome` to point
  at Convay too (for when the redirect isn't configured), that needs a small change to `DefaultWelcome`.
- **Legacy 1:1 call indicator** in the room list (see above).

## Ported cleanly (no conflict)

Convay JWT login plumbing (`index.ts` auth redirect), call duration widget (`CallDuration`,
`CallView`, `VideoFeed`, `LegacyCallHandler`, `placeCall`, `models/Call`), widget/Element-Call
wiring (`AppTile`, `ElementWidgetActions`, `WidgetMessaging`, `vector/jitsi/*`), spotlight/public-room
removal (`SpotlightDialog`), settings (`UserSettingsDialog`, `RoomSummaryCardView`), composer
bullet-point (`BasicMessageComposer`, `MessageComposerFormatBar`, `editor/operations`), room-list
settings button (`RoomListSearchView*` + `RoomListSearchViewModel`), branding (icons, `manifest.json`),
and the four `config-*.json` files (now under `apps/web/`).

## Additional fixes to reach a green build / tests

Type/lint/build:
- `VideoFeed.tsx` — `getDerivedStateFromProps` return type widened to `Partial<IState>` (it only
  derives mute state; the fork's `callLengthSeconds` is timer-driven and must not be reset).
- `AuthFooter.tsx` — removed now-unused `_t` import (the fork commented out the footer links).
- `vector/index.ts` — import ordering fixed for the added `SdkConfig` import.
- `en_EN.json` — ran `matrix-sort-i18n` (the fork's `recipient_busy` keys were out of alphabetical order).
- `_SpacePanel.pcss` / `_VideoFeed.pcss` — stylelint `--fix` (duplicate `display`, `rgba`→`rgb`).

Real test regressions from the port (fixed):
- **`setPresence` on incomplete mock clients** — the fork's in-call presence signaling
  (`models/Call.ts` + `LegacyCallHandler.tsx`) called `client.setPresence(...)` directly, which threw
  in the many call-lifecycle tests whose mock clients lack that method (broke `Call`, `CallEvent`,
  `RoomTile`, `RoomCallBanner`, `Algorithm`, `LegacyCallHandler`). Guarded with optional chaining
  (`client.setPresence?.(...)?.catch(...)`) — best-effort, identical production behavior, never breaks
  the call lifecycle.
- **`VideoFeed-test` mock call** — the fork's call-duration listener (`call.on(LengthChanged)`) needs an
  EventEmitter; added `on`/`removeListener` to that test's mock call.

Test updates to match intentional fork behavior:
- `FormattingButtons-test` — expected label updated `Bulleted list` → `Bullet point` (the fork's rename).
- `SecurityUserSettingsTab-test.tsx.snap` — regenerated (−61 lines = the now-hidden encryption section only).
  The "renders privacy header" gating test passes unchanged because we kept upstream's `privacySection` gating.
- Snapshots regenerated (`jest -u`, 28 snapshots) for components the fork changed or that embed the
  emptied `AuthFooter` (`ShareDialog`, `UserSettingsDialog`, `SpotlightDialog`, `AuthPage`,
  `RoomSummaryCardView`, `CompleteSecurity`, `VideoFeed`, `LegacyCallHandler`, …).

## Build / verification status (Node v24.12.0, pnpm 10.33.3)

- `pnpm install` — ✅ (50s)
- `lint:types` (web, incl. module_system + playwright projects) — ✅
- `lint:js` (web + shared-components) — ✅
- `lint:prettier` (repo) — ✅
- `lint:style` (stylelint) — ✅
- `build` (webpack production) — ✅ (only pre-existing bundle-size warnings)
- **Full web jest suite — 6711 passed, 25 skipped, 782/782 snapshots pass; 37 failed across 3 suites (all expected, see below)**
- `lint:knip` / `lint:workflows` — not run (repo-hygiene checks unrelated to the port)
- shared-components `test:unit` — ⚠️ cannot run in this sandbox (vitest **browser** mode via
  Playwright segfaults with no display). Type-checked + lint-clean; needs a browser-capable env.

### Remaining 37 jest failures — all expected, none are port regressions

Verified by re-running each suite in isolation. **No code regressions remain** — these upstream tests
assert behavior the fork *intentionally* removed/changed, and would fail on the fork against any
element-web version (the fork never reconciled them):

| Suite | Failing | Cause (intentional fork change) |
|---|---|---|
| `SpotlightDialog-test` | ~20 | Fork **removed public-room search / knock / nsfw filters** — tests query elements that no longer render. |
| `UserSettingsDialog-test` | ~9 | Fork changed the settings tabs / default tab (`Account` → `Sessions`). |
| `MatrixChat-test` | ~8 | Tests wait for the **"Powered by Matrix"** footer text as a render sentinel; the fork emptied `AuthFooter`. |

Plus a small number of **run-varying pollution** artifacts (e.g. `SetIdServer`, `VerificationQRCode`,
`MessageComposerButtons`) — these **pass in isolation** and fail only inside element-web's single-process
702-suite run due to known cross-suite mock bleed; not caused by the port.

To reach a fully-green suite, these three suites' tests would need updating to assert the fork's product
decisions (delete/skip the removed public-room-search tests, fix the expected tabs, replace the footer
sentinel). Left as follow-up — flag if you want them reconciled.

## Manual smoke test — requires your environment

The interactive smoke test (Convay JWT login against the real validate API, Element Call,
branding, etc.) **cannot be done in this sandbox** — it needs the Convay backend and a browser.
Run `develop-v2` against a dev config and verify:
- JWT login: open `…/#/jwt=<token>` → API validation → redirect to `#/` (or failure → `jwt_failure_redirect_url`).
- `auth_pages_redirect_url` redirect away from `/welcome` `/login` `/register`.
- Call duration widget + video feed; Element Call wiring; busy-recipient toast.
- Branding (icons, manifest, brand-based welcome title), removed public-room search in spotlight,
  room-list settings button, bullet-point composer formatting, hidden encryption settings section.
