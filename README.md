# Shopping List

A simple progressive web app (PWA) for creating and organizing a shopping list. It runs in the browser, saves changes in the device's local storage, and can remain available offline after the first visit.

## Features

- Add one or more items; enter each item on a separate line.
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

The tests cover category persistence and normalization, item grouping, views, item reordering, export/import validation and merging, download handling, cancellation, stale file reads, persistence failures, and some interaction behavior. They use a simulated DOM, so native downloads, file pickers, the UI and gestures should also be checked in a browser.

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
