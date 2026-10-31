# Shopping List

A simple progressive web app (PWA) for creating and organizing a shopping list. It runs in the browser, saves changes in the device's local storage, and can remain available offline after the first visit.

## Features

- Add one or more items; enter each item on a separate line.
- Mark items as bought or pending, and delete them.
- Assign existing categories or create new ones.
- Switch between list view and a view grouped by category.
- Sort, remove duplicates, check or uncheck all, and delete all items in each section.
- Reorder items using drag and drop.
- Switch between light and dark themes; preferences and items are saved in the browser.
- Install the app in supported browsers and load cached resources offline using a service worker.

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

The tests cover category persistence and normalization, item grouping, views, item reordering, and some interaction behavior. They use a simulated DOM, so the UI and gestures should also be checked in a browser.

## Project structure

- `index.html`: interface structure and PWA resources.
- `css/styles.css`: styles and themes.
- `js/script.js`: shopping list, preferences, and category logic.
- `sw.js`: resource caching and offline support.
- `pwa/manifest.json`: PWA installation metadata.
- `assets/`: app icons.
- `tests/categories.test.cjs`: automated tests.
