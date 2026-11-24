# Shopping List

A simple progressive web app (PWA) for creating and organizing a shopping list. It runs in the browser, saves changes in the device's local storage, and can remain available offline after the first visit.

## Features

- Add one or more items; enter each item on a separate line.
- Get matching pending and completed items below the input as you type. Suggestions use the whole line at the cursor and ignore case. Selecting one returns it to pending without duplicating an existing pending item, preserves its category, and clears only that draft line. Use click, touch, or Tab then Enter to select; Escape dismisses suggestions. Enter in the input still inserts a new line.
- Mark items as bought or pending, and delete them.
- Assign existing categories or create new ones.
- Switch between list view and a view grouped by category.
- Sort, remove duplicates, check or uncheck all, and delete all items in each section.
- Reorder items using drag and drop.
- Export all items and their categories to a JSON file, and import a shared list without replacing your existing items.
- Switch between light and dark themes; preferences and items are saved in the browser.
- Install the app in supported browsers and load cached resources offline using a service worker.

## Share a list

1. Open the **⋮** menu in the header, next to the theme button.
2. Choose **Export list** to download a file named `shopping-list-YYYY-MM-DD.json`. It includes **every item**, pending and completed, with its category, regardless of the selected view.
3. Share that file using email, messaging, or another file-sharing method.
4. On the receiving device, open the same menu and choose **Import list**. Select the file, review the counts, and press **Import** to save the new items locally.

Importing never deletes or updates existing items. Matching names (ignoring case and leading/trailing whitespace) are skipped, keeping the local item's category and completion status. Repeated names in the file are only added once; the first occurrence wins. New items keep their imported status and categories, reuse existing category spelling, and receive new local IDs. Importing the same file again does not create duplicates. Theme and view preferences are not transferred.

Exports use a versioned JSON format: `format: "shopping-list"`, `version: 1`, `exportedAt` (an ISO timestamp), and an `items` array containing `id`, `text`, `completed`, and `category` (a string or `null`). Categories are stored on items, not as a separate catalog. Imports accept exports of up to 5 MiB. Invalid or unsupported files are rejected entirely; cancelling or a storage failure leaves your current list unchanged.

Export and import use local browser APIs and work offline once the app has loaded. This is manual file sharing, not automatic synchronization. **Files are not encrypted** and may contain personal information; share them only with intended recipients. Your browser controls where downloads are saved.

## Run locally

No dependencies are required to run the app. Since it uses a web app manifest and a service worker, serve it from a local web server instead of opening `index.html` directly as a file. On macOS, open Terminal in the project folder and run:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a browser. To stop the server, press `Ctrl+C` in the terminal.

The first visit needs the local server to load the files and register the service worker. After that, you can test offline mode in the browser's developer tools by enabling the “Offline” option and reloading the page. App installation and some PWA features depend on the browser.

## Run the tests

The automated tests require no additional packages, but they do require Node.js. From the project folder, run:

```sh
node --test tests/categories.test.cjs
```

The tests cover multiline autocomplete, suggestion selection and deduplication, category persistence and normalization, item grouping, views, item reordering, export/import validation and merging, download handling, cancellation, stale file reads, persistence failures, and some interaction behavior. They use a simulated DOM, so native downloads, file pickers, focus, the UI and gestures should also be checked in a browser.

### Browser tests with Playwright

The app still needs no build or runtime packages. Browser tests require development dependencies; use Node.js 24 (also used in CI):

```sh
npm ci
npx playwright install chromium webkit
npm run test:e2e
```

On Linux, use `npx playwright install --with-deps chromium webkit` to install browser system dependencies too. Playwright downloads its own browsers; existing Chrome or Safari installations are not required. Firefox is not installed or tested.

Playwright starts and stops a local HTTP server at `http://127.0.0.1:4173`. No separate server is needed. It can reuse a server already running there locally; make sure it serves this checkout. CI always starts a fresh server. Each test gets a clean browser context, with no shared tasks, preferences or caches. Seed helpers write once and then reload, so later reloads genuinely test persistence.

```sh
npm run test:unit
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=mobile-webkit
npm run test:e2e -- --project=pwa-chromium
npm run test:e2e:ui
npm run test:e2e:debug -- tests/e2e/categories.spec.cjs --project=chromium
npm run test:e2e:report
```

`npm test` runs unit tests followed by the browser suite. The browser projects are `chromium`, `webkit`, `mobile-chromium` (Pixel 7), `mobile-webkit` (iPhone 13), and `pwa-chromium`. Functional projects block service workers to avoid cache interference; the isolated PWA project allows them and waits for worker control before going offline.

| Functionality | Spec under `tests/e2e/` | Projects |
| --- | --- | --- |
| Empty state, multiline entry, duplicates, completion, deletion, bulk actions, storage warnings | `tasks.spec.cjs` | Desktop and mobile |
| Matching suggestions, current draft line, reactivation, dismissal and keyboard selection | `autocomplete.spec.cjs` | Desktop and mobile; tap only on mobile |
| Category creation, selection, normalization, removal, cancellation, grouping and saved view | `categories.spec.cjs` | Desktop and mobile |
| JSON download/round-trip, merging, preview, cancellation, invalid files, size limit and failed writes | `transfer.spec.cjs` | Desktop and mobile |
| Menus, keyboard, focus, theme, sticky form, viewport fit and dialog layout | `interactions.spec.cjs` | Desktop and mobile |
| Native drag-and-drop, destination state, category restrictions and mouse hold | `interactions.spec.cjs` | Desktop only |
| Tap selection and simulated touch-pointer hold/cancellation | Autocomplete and interactions specs | Mobile only |
| Offline reload, local edits, offline files, navigation fallback, cache cleanup, manifest and simulated install events | `pwa.spec.cjs` | PWA Chromium only |

Tests intentionally skip mouse-only gestures on mobile projects and touch-only interactions on desktop. Touch-pointer hold tests dispatch synthetic pointer events and are integration checks, not proof of native long-press behavior on a phone. WebKit keyboard tests use Option+Tab on macOS, where the default Tab behavior does not visit buttons. Exhaustive parsing, composition and stale-file-read cases remain in the unit suite.

The HTML report is written to `playwright-report/`. Failures retain screenshots, videos and traces in `test-results/`; the layout test also attaches desktop/mobile screenshots. To inspect a trace, run `npx playwright show-trace <path-to-trace.zip>`. Local runs have no retries; CI retries once and reports flaky results. Avoid arbitrary sleeps: use visible state, browser events and Playwright's retrying assertions. Gesture cancellation uses the controlled page clock.

GitHub Actions runs unit and browser tests as independent jobs on pushes and pull requests, so failures in either remain visible without preventing the other suite from running. Reports and failure artifacts are retained for 14 days. The browser job covers both engines, both mobile profiles and the PWA project, using two workers.

**Manual checks:** install and launch the PWA on actual desktop/Android/iOS devices; check native touch holds and scrolling, downloads/file sharing and the on-screen keyboard. Emulated iPhone WebKit is not a real iPhone Safari session. Installation events are simulated, and cache cleanup is tested, but upgrading between two deployed app versions is not. These tests are not a complete accessibility audit or a remote synchronization test; the app stores data locally.

## Project structure

- `index.html`: interface structure and PWA resources.
- `css/styles.css`: styles and themes.
- `js/script.js`: shopping-list state, rendering, categories, and interactions.
- `js/list-transfer.js`: JSON export/import validation and merge planning.
- `js/pwa.js`: theme, install prompt, service worker, and sticky-form behavior.
- `sw.js`: resource caching and offline support.
- `pwa/manifest.json`: PWA installation metadata.
- `assets/`: app icons.
- `tests/categories.test.cjs`: automated tests.
- `tests/e2e/`: Playwright fixtures and browser scenarios.
- `playwright.config.cjs`: browser projects, isolation, server and reporting.
- `.github/workflows/e2e.yml`: unit and browser CI jobs.
