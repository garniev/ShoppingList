const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Small DOM double keeps regression tests dependency-free. Real mobile gesture
// behavior and dialog rendering still require browser/device verification.
class Element {
  constructor(tag = "div", document) {
    this.tagName = tag;
    this.document = document;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.value = "";
    this.open = false;
    this.hidden = false;
    this.isConnected = false;
    this.classList = {
      add: (...names) => {
        this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" ");
      },
      remove: (...names) => {
        this.className = this.className.split(/\s+/).filter((name) => name && !names.includes(name)).join(" ");
      },
      contains: (name) => this.className.split(/\s+/).includes(name)
    };
  }
  set innerHTML(value) {
    for (const child of this.children) {
      child.disconnect();
      child.parent = null;
    }
    this.children = [];
    this.html = value;
  }
  disconnect() {
    this.setConnected(false);
  }
  setConnected(connected) {
    this.isConnected = connected;
    this.children.forEach((child) => child.setConnected(connected));
  }
  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }
  appendChild(child) {
    child.remove();
    child.parent = this;
    child.setConnected(this.isConnected);
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    this.disconnect();
  }
  click() {
    if (this.disabled) return;
    if (this.tagName === "a") this.document.onDownload?.(this);
    return this.dispatch("click");
  }
  replaceChildren(...children) {
    this.innerHTML = "";
    this.append(...children);
  }
  add(child) { this.append(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback, options) {
    (this.listeners[name] ||= []).push({ callback, capture: options === true });
  }
  dispatch(name, extras = {}) {
    const event = {
      target: this, detail: 1, dataTransfer: { setData() {} },
      preventDefault() { this.prevented = true; },
      stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; },
      ...extras
    };
    const listeners = [...(this.listeners[name] || [])].sort((a, b) => b.capture - a.capture);
    for (const { callback } of listeners) {
      callback(event);
      if (event.stopped) break;
    }
    return event;
  }
  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some((part) => this.matches(part.trim()));
    if (selector === "button") return this.tagName === "button";
    if (selector === "button:not([data-hold-target])") {
      return this.tagName === "button" && !this.dataset.holdTarget;
    }
    if (/^\[data-[\w-]+\]$/.test(selector)) {
      const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return Object.hasOwn(this.dataset, key);
    }
    const [tag, ...classes] = selector.split(".");
    return (!tag || this.tagName === tag) &&
      classes.every((name) => this.classList.contains(name));
  }
  closest(selector) {
    return this.matches(selector) ? this : this.parent?.closest(selector);
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  focus(options) {
    this.document.activeElement = this;
    this.focusOptions = options;
  }
  getBoundingClientRect() { return { top: 0, height: 0 }; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch("close"); }
  setCustomValidity(message) { this.validationMessage = message; }
  reportValidity() { return !this.validationMessage; }
}

function setup(initial = [], view = "list") {
  const storage = new Map([
    ["task-done-items", JSON.stringify(initial)], ["task-view-preference", view]
  ]);
  const document = new Element("document");
  document.document = document;
  document.isConnected = true;
  document.body = new Element("body", document);
  document.append(document.body);
  const ids = {};
  for (const id of ["taskForm", "taskInput", "taskList", "themeToggle", "installButton",
    "categoryDialog", "categorySelect", "newCategory", "appStatus", "categoryTaskName",
    "categoryForm", "cancelCategory", "transferMenu", "transferMenuButton", "exportList",
    "importList", "importDialog", "importFile", "importFeedback", "confirmImport",
    "importForm", "cancelImport"]) {
    const tag = /Button$|Toggle$|^(exportList|importList|confirmImport|cancelImport|cancelCategory)$/.test(id)
      ? "button" : /Form$/.test(id) ? "form" : /Dialog$/.test(id) ? "dialog"
        : /Input$|^newCategory$|^importFile$/.test(id) ? "input"
          : id === "categorySelect" ? "select" : "div";
    ids[id] = new Element(tag, document);
    document.body.append(ids[id]);
  }
  ids.appStatus.hidden = true;
  ids.transferMenu.className = "action-menu";
  ids.transferMenuButton.className = "action-menu-button";
  ids.transferMenuButton.setAttribute("aria-expanded", "false");
  const transferOptions = new Element("div", document);
  transferOptions.className = "action-menu-options";
  transferOptions.hidden = true;
  transferOptions.append(ids.exportList, ids.importList);
  ids.transferMenu.append(ids.transferMenuButton, transferOptions);
  ids.importForm.append(ids.importFile, ids.importFeedback, ids.confirmImport, ids.cancelImport);
  ids.importDialog.append(ids.importForm);
  ids.importFile.files = [];
  ids.confirmImport.disabled = true;
  document.getElementById = (id) => ids[id];
  document.createElement = (tag) => new Element(tag, document);
  for (const value of ["list", "categories"]) {
    const button = new Element("button", document);
    button.dataset.view = value;
    document.body.append(button);
  }
  let nextTimer = 0;
  const timers = new Map();
  const downloads = [];
  const objectURLs = new Map();
  const revokedURLs = [];
  const consoleErrors = [];
  const writes = [];
  let nextURL = 0;
  document.onDownload = (link) => downloads.push({
    href: link.href, filename: link.download, blob: objectURLs.get(link.href),
    connectedAtClick: link.isConnected, parentAtClick: link.parent, link
  });
  const context = vm.createContext({
    document, navigator: {}, console: { error: (...args) => consoleErrors.push(args) },
    crypto: require("node:crypto").webcrypto, Blob,
    URL: {
      createObjectURL: (blob) => {
        const url = `blob:test-${++nextURL}`;
        objectURLs.set(url, blob);
        return url;
      },
      revokeObjectURL: (url) => { revokedURLs.push(url); objectURLs.delete(url); }
    },
    window: Object.assign(new Element("window", document), {
      scrollY: 0,
      requestAnimationFrame: (callback) => callback()
    }),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { writes.push({ key, value }); storage.set(key, value); }
    },
    setTimeout: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    Option: function(text, value) {
      const option = new Element("option", document);
      option.textContent = text;
      option.value = value;
      return option;
    }
  });
  for (const script of ["list-transfer.js", "pwa.js", "script.js"]) {
    vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, `../js/${script}`), "utf8"), context);
  }
  return {
    ids, storage, document, context, downloads, objectURLs, revokedURLs, consoleErrors, writes,
    transferOptions,
    run: (source) => vm.runInContext(source, context),
    snapshot: () => JSON.parse(vm.runInContext("JSON.stringify(tasks)", context)),
    hold: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); },
    cards: () => ids.taskList.querySelectorAll(".task"),
    async preview(file) {
      ids.importFile.files = file ? [file] : [];
      ids.importFile.value = file ? "fake-path/list.json" : "";
      await this.run("previewImportFile()");
    },
    confirm: () => ids.importForm.dispatch("submit"),
    assign(id, name) {
      vm.runInContext(`openCategoryDialog(${JSON.stringify(id)}, taskInput)`, context);
      ids.newCategory.value = name;
      ids.categoryForm.dispatch("submit");
    }
  };
}

const item = (id, category, completed = false) => ({ id, text: `Item ${id}`, completed, ...(category === undefined ? {} : { category }) });

const plain = (value) => JSON.parse(JSON.stringify(value));
const envelope = (items = [], extra = {}) => ({
  format: "shopping-list", version: 1, exportedAt: "2026-10-31T12:34:56.000Z", items, ...extra
});
function importFile(data, { size, text } = {}) {
  const contents = typeof data === "string" ? data : JSON.stringify(data);
  return {
    size: size ?? Buffer.byteLength(contents), reads: 0,
    text() { this.reads++; return text ? text() : Promise.resolve(contents); }
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function unchanged(app, tasks, storage) {
  assert.deepEqual(app.snapshot(), tasks);
  assert.equal(app.storage.get("task-done-items"), storage);
}
function assertImportReset(app) {
  assert.equal(app.run("pendingImport"), null);
  assert.equal(app.ids.importFile.value, "");
  assert.equal(app.ids.confirmImport.disabled, true);
  assert.equal(app.ids.importFeedback.textContent, "Choose a file to preview its contents.");
}

test("legacy tasks migrate without losing fields and category survives reload", () => {
  const app = setup([item("a")]);
  assert.equal(app.snapshot()[0].category, null);
  app.assign("a", "  My   category  ");
  const saved = JSON.parse(app.storage.get("task-done-items"));
  assert.deepEqual(saved, [item("a", "My category")]);
  assert.deepEqual(setup(saved).snapshot(), saved);
});

test("category names reuse existing spelling; removing category and cancelling work", () => {
  const app = setup([item("a", "Home"), item("b")]);
  app.assign("b", " HOME ");
  assert.equal(app.snapshot()[1].category, "Home");
  app.run('openCategoryDialog("b", taskInput)');
  app.ids.newCategory.value = "Never saved";
  app.ids.cancelCategory.dispatch("click");
  assert.equal(app.snapshot()[1].category, "Home");
  app.run('openCategoryDialog("b", taskInput)');
  app.ids.categorySelect.value = "";
  app.ids.categoryForm.dispatch("submit");
  assert.equal(app.snapshot()[1].category, null);
});

test("blank new names rejected; markup remains text", () => {
  const app = setup([item("a")]);
  app.assign("a", "   ");
  assert.equal(app.ids.categoryDialog.open, true);
  assert.ok(app.ids.newCategory.validationMessage);
  app.ids.newCategory.value = "<img src=x onerror=alert(1)>";
  app.ids.categoryForm.dispatch("submit");
  assert.equal(app.snapshot()[0].category, "<img src=x onerror=alert(1)>");
});

test("only pending tasks grouped, uncategorized last, completed list remains unique", () => {
  const app = setup([item("a", "Zoo"), item("b"), item("c", "Home"), item("d", "Home", true)], "categories");
  assert.deepEqual(app.cards().map((card) => card.dataset.taskId), ["c", "a", "b", "d"]);
  assert.deepEqual(app.ids.taskList.querySelectorAll(".category-group-header").map((el) => el.textContent),
    ["Home (1)", "Zoo (1)", "Uncategorized (1)"]);
  assert.equal(app.ids.taskList.querySelectorAll(".task-group-header").length, 2);
  app.run('toggleTask("c")');
  assert.equal(app.snapshot().find((task) => task.id === "c").category, "Home");
  assert.equal(app.ids.taskList.querySelectorAll(".category-group-header").length, 2);
  app.run('toggleTask("c"); setAllTasksCompleted(true); setAllTasksCompleted(false)');
  assert.equal(app.snapshot().find((task) => task.id === "c").category, "Home");
});

test("restoring focus after reactivating a task does not request scrolling", () => {
  const app = setup([item("a", null, true)]);
  app.cards()[0].querySelector(".task-text").focus();

  app.run('toggleTask("a")');

  const focusedTask = app.document.activeElement;
  assert.equal(focusedTask.closest(".task").dataset.taskId, "a");
  assert.equal(focusedTask.focusOptions.preventScroll, true);
});

test("reactivating by text preserves category; views persist independently", () => {
  const app = setup([item("a", "Home", true)]);
  app.run('addTasks(["Item a"])');
  assert.deepEqual(app.snapshot(), [item("a", "Home")]);
  app.document.querySelectorAll("[data-view]")[1].dispatch("click");
  assert.equal(app.storage.get("task-view-preference"), "categories");
  assert.equal(app.ids.taskList.querySelectorAll(".category-group-header").length, 1);
});

test("grouped drag rejects cross-group moves and general drag uses destination state", () => {
  const app = setup([item("a", "Home"), item("b", "Home"), item("c", "Zoo"), item("d", null, true)], "categories");
  app.run('moveTask("a", "c", true); moveTask("a", "d", true)');
  assert.deepEqual(app.snapshot().map((task) => task.id), ["a", "b", "c", "d"]);
  app.run('moveTask("a", "b", false)');
  assert.deepEqual(app.snapshot().map((task) => task.id), ["b", "a", "c", "d"]);
  app.run('currentView = "list"; moveTask("a", "d", true)');
  assert.equal(app.snapshot().find((task) => task.id === "a").completed, true);
  assert.equal(app.snapshot().find((task) => task.id === "a").category, "Home");
});

test("long hold on text opens dialog, consumes release click, next short click completes", () => {
  const app = setup([item("a")]);
  const card = app.cards()[0];
  const text = card.querySelector(".task-text");
  card.dispatch("pointerdown", { target: text, isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  app.hold();
  assert.equal(app.ids.categoryDialog.open, true);
  assert.equal(card.dispatch("click", { target: text }).stopped, true);
  assert.equal(app.snapshot()[0].completed, false);
  app.ids.categoryDialog.close();
  card.dispatch("pointerdown", { target: text, isPrimary: true, button: 0, clientX: 0, clientY: 0 });
  card.dispatch("pointerup");
  app.hold();
  text.dispatch("click");
  assert.equal(app.snapshot()[0].completed, true);
});

test("movement, scrolling, pointer cancellation and action buttons do not trigger hold", () => {
  for (const cancel of ["pointermove", "pointercancel", "dragstart", "scroll", "button"]) {
    const app = setup([item("a")]);
    const card = app.cards()[0];
    card.dispatch("pointerdown", {
      target: card.querySelector(cancel === "button" ? ".category-button" : ".task-text"),
      isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0
    });
    if (cancel === "scroll") app.document.dispatch("scroll");
    else if (cancel !== "button") card.dispatch(cancel, { pointerId: 1, clientX: 20, clientY: 0 });
    app.hold();
    assert.equal(app.ids.categoryDialog.open, false, cancel);
  }
});

test("empty and completed-only lists do not create empty category groups", () => {
  for (const initial of [[], [item("a", "Home", true)]]) {
    const app = setup(initial, "categories");
    assert.equal(app.ids.taskList.querySelectorAll(".category-group-header").length, 0);
  }
});

test("createListExport copies only supported fields, normalizes categories and does not mutate input", () => {
  const app = setup([item("local", "Home")]);
  const source = [
    { ...item("a", "  Fruit   shop  ", true), text: "  Apples\n& pears  ", secret: "ignored" },
    item("b"), item("c", "   ")
  ];
  app.context.source = source;
  const before = plain(source);
  const exported = app.run("createListExport(source)");
  assert.deepEqual(Object.keys(exported).sort(), ["exportedAt", "format", "items", "version"]);
  assert.equal(exported.format, "shopping-list");
  assert.equal(exported.version, 1);
  assert.equal(new Date(exported.exportedAt).toISOString(), exported.exportedAt);
  assert.deepEqual(plain(exported.items), [
    { id: "a", text: "  Apples\n& pears  ", completed: true, category: "Fruit shop" },
    item("b", null), item("c", null)
  ]);
  assert.notEqual(exported.items[0], source[0]);
  assert.deepEqual(source, before);
  assert.deepEqual(plain(app.run("createListExport().items")), app.snapshot());
});

test("parseListImport accepts legacy IDs and ignores unknown fields while keeping markup as text", () => {
  const app = setup();
  const markup = '<img src=x onerror="alert(1)"> & <script>bad()</script>';
  const data = envelope([
    { id: "legacy-id", text: `  ${markup}\n  `, completed: true, category: "  <b>Food</b>   shop  ", html: markup },
    item("other", null)
  ], { theme: "light", view: "categories", unknown: { anything: true } });
  app.context.contents = JSON.stringify(data);
  assert.deepEqual(plain(app.run("parseListImport(contents)")), [
    { id: "legacy-id", text: `  ${markup}\n  `, completed: true, category: "<b>Food</b> shop" },
    item("other", null)
  ]);
});

test("invalid JSON, root, format, version, date and items reject the entire file", async (t) => {
  const cases = [
    ["invalid JSON", "{not json"], ["null", "null"], ["array", "[]"],
    ["string root", '"shopping-list"'], ["number root", "1"],
    ["missing format", JSON.stringify({ version: 1, exportedAt: envelope().exportedAt, items: [] })],
    ["wrong format", envelope([], { format: "other" })],
    ["missing version", { format: "shopping-list", exportedAt: envelope().exportedAt, items: [] }],
    ["future version", envelope([], { version: 2 })],
    ["string version", envelope([], { version: "1" })],
    ["null version", envelope([], { version: null })],
    ["missing date", { format: "shopping-list", version: 1, items: [] }],
    ["invalid date", envelope([], { exportedAt: "not-a-date" })],
    ["numeric date", envelope([], { exportedAt: 123 })],
    ["null date", envelope([], { exportedAt: null })],
    ["missing items", { format: "shopping-list", version: 1, exportedAt: envelope().exportedAt }],
    ["object items", envelope({}, {})], ["null items", envelope(null)]
  ];
  for (const [label, data] of cases) {
    await t.test(label, async () => {
      const app = setup([item("local", "Home", true)]);
      const before = app.snapshot(), saved = app.storage.get("task-done-items");
      app.context.contents = typeof data === "string" ? data : JSON.stringify(data);
      assert.throws(() => app.run("parseListImport(contents)"));
      app.ids.importList.click();
      await app.preview(importFile(data));
      assert.equal(app.ids.importDialog.open, true);
      assert.equal(app.ids.confirmImport.disabled, true);
      assert.equal(app.run("pendingImport"), null);
      assert.match(app.ids.importFeedback.textContent, /not valid JSON|not a Shopping List|not supported|incomplete or damaged/);
      app.confirm();
      unchanged(app, before, saved);
      assert.equal(app.writes.length, 0);
    });
  }
});

test("invalid item fields reject valid preceding items rather than partially importing", async (t) => {
  const valid = item("incoming", "Food");
  const cases = [["null item", null], ["array item", []], ["string item", "bad"]];
  const invalidFields = {
    id: [undefined, null, 7, "", " \t\n"],
    text: [undefined, null, 7, "", " \t\n"],
    completed: [undefined, null, 0, "false"],
    category: [undefined, false, 7, {}, [], "", " \t\n"]
  };
  for (const [field, values] of Object.entries(invalidFields)) {
    for (const [index, value] of values.entries()) {
      const invalid = { ...valid, [field]: value };
      if (value === undefined) delete invalid[field];
      cases.push([`${field} invalid value ${index}`, invalid]);
    }
  }
  for (const [label, invalid] of cases) {
    await t.test(label, async () => {
      const app = setup([item("local", null)]);
      const before = app.snapshot(), saved = app.storage.get("task-done-items");
      const data = envelope([item("valid-first", null, true), invalid]);
      app.context.contents = JSON.stringify(data);
      assert.throws(() => app.run("parseListImport(contents)"), /Item 2 is invalid/);
      app.ids.importList.click();
      await app.preview(importFile(data));
      assert.match(app.ids.importFeedback.textContent, /Item 2 is invalid. Nothing has been imported/);
      assert.equal(app.ids.confirmImport.disabled, true);
      assert.equal(app.run("pendingImport"), null);
      app.confirm();
      unchanged(app, before, saved);
      assert.equal(app.writes.length, 0);
      assert.equal(app.ids.importDialog.open, true);
    });
  }
});

test("planListImport matches names by case/trim, keeps local fields and first internal duplicate wins", () => {
  const app = setup();
  const existing = [
    { id: "collision", text: "  MILK  ", completed: true, category: "Home", localOnly: 42 },
    { id: "other", text: "Pears", completed: false, category: "Fruit shop" }
  ];
  const incoming = [
    { id: "different", text: "milk", completed: false, category: "Never added" },
    { id: "collision", text: "  Bread  ", completed: true, category: "  HOME  " },
    { id: "collision", text: "bread", completed: false, category: "Discarded category" },
    { id: "collision", text: "Oranges", completed: false, category: "  fruit   SHOP " },
    { id: "new", text: "Tea", completed: true, category: "New Shop" },
    { id: "new", text: "Coffee", completed: false, category: "NEW SHOP" }
  ];
  const before = plain({ existing, incoming });
  Object.assign(app.context, { existing, incoming });
  const plan = plain(app.run("planListImport(incoming, existing)"));
  assert.equal(plan.skipped, 2);
  assert.deepEqual(plan.additions, [
    { id: "collision", text: "  Bread  ", completed: true, category: "Home" },
    { id: "collision", text: "Oranges", completed: false, category: "Fruit shop" },
    { id: "new", text: "Tea", completed: true, category: "New Shop" },
    { id: "new", text: "Coffee", completed: false, category: "New Shop" }
  ]);
  assert.deepEqual({ existing, incoming }, before);
  app.context.merged = [...existing, ...plan.additions];
  assert.deepEqual(plain(app.run("planListImport(incoming, merged)")), { additions: [], skipped: incoming.length });
  assert.deepEqual(plain(app.run("planListImport([], existing)")), { additions: [], skipped: 0 });
  assert.deepEqual(plain(app.run("planListImport([], [])")), { additions: [], skipped: 0 });
});

test("export UI downloads all states/categories in internal order from either view, including empty lists", async (t) => {
  for (const view of ["list", "categories"]) {
    for (const [label, initial] of [
      ["mixed", [item("z", "Zoo", true), item("b", null), item("a", "Home")]],
      ["completed only", [item("done", "Home", true)]],
      ["pending only", [item("pending", "Home")]], ["empty", []]
    ]) {
      await t.test(`${view}: ${label}`, async () => {
        const app = setup(initial, view);
        const before = app.snapshot(), saved = app.storage.get("task-done-items");
        app.ids.transferMenuButton.click();
        assert.equal(app.transferOptions.hidden, false);
        app.ids.exportList.click();
        assert.equal(app.downloads.length, 1);
        const download = app.downloads[0];
        assert.equal(download.connectedAtClick, true);
        assert.equal(download.parentAtClick, app.document.body);
        assert.equal(download.blob.type, "application/json");
        const data = JSON.parse(await download.blob.text());
        assert.deepEqual(data.items, before);
        assert.deepEqual(Object.keys(data).sort(), ["exportedAt", "format", "items", "version"]);
        assert.equal(data.format, "shopping-list");
        assert.equal(data.version, 1);
        assert.equal(download.filename, `shopping-list-${data.exportedAt.slice(0, 10)}.json`);
        assert.equal(download.link.isConnected, false);
        assert.equal(download.link.parent, null);
        assert.equal(app.document.body.querySelectorAll("a").length, 0);
        assert.equal(app.revokedURLs.length, 0, "URL remains live until download can start");
        assert.equal(app.objectURLs.get(download.href), download.blob);
        app.hold();
        assert.deepEqual(app.revokedURLs, [download.href]);
        assert.equal(app.objectURLs.size, 0);
        assert.equal(app.transferOptions.hidden, true);
        assert.equal(app.ids.transferMenuButton.attributes["aria-expanded"], "false");
        assert.equal(app.document.activeElement, app.ids.transferMenuButton);
        assert.equal(app.ids.transferMenuButton.focusOptions.preventScroll, true);
        assert.equal(app.ids.appStatus.hidden, false);
        assert.match(app.ids.appStatus.textContent, new RegExp(`Includes all ${initial.length} items`));
        unchanged(app, before, saved);
        assert.equal(app.writes.length, 0);
      });
    }
  }
});

test("roundtrip through download/preview/confirm preserves text, state and categories with regenerated IDs", async () => {
  const source = setup([
    { id: "legacy", text: "  Milk\n& bread  ", completed: true, category: "Home" },
    { id: "other", text: "<script>alert(1)</script>", completed: false, category: "<b>Food</b>" },
    item("none", null)
  ], "categories");
  source.ids.exportList.click();
  const fileContents = await source.downloads[0].blob.text();
  const target = setup([], "list");
  target.ids.importList.click();
  await target.preview(importFile(fileContents));
  assert.equal(target.ids.confirmImport.disabled, false);
  assert.equal(target.confirm().prevented, true);
  const imported = target.snapshot();
  assert.deepEqual(imported.map(({ id, ...fields }) => fields), source.snapshot().map(({ id, ...fields }) => fields));
  assert.equal(new Set(imported.map((task) => task.id)).size, imported.length);
  for (const task of imported) {
    assert.ok(!source.snapshot().some((original) => original.id === task.id));
    assert.match(task.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  assert.deepEqual(JSON.parse(target.storage.get("task-done-items")), imported);
  assert.deepEqual(setup(imported).snapshot(), imported);
  assert.equal(target.storage.get("task-view-preference"), "list");
  assert.equal(target.cards().find((card) => card.dataset.taskId === imported[1].id).querySelector(".task-text").textContent,
    "<script>alert(1)</script>");
  assert.ok(target.cards().some((card) => card.querySelector(".category-button").textContent === "<b>Food</b>"));
  assert.equal(target.document.querySelectorAll("script").length, 0);
  assert.equal(target.document.querySelectorAll("b").length, 0);
  assert.equal(target.ids.importDialog.open, false);
  assertImportReset(target);
  assert.equal(target.document.activeElement, target.ids.transferMenuButton);
  assert.equal(target.ids.transferMenuButton.focusOptions.preventScroll, true);
});

test("UI merge keeps locals intact despite ID collisions; internal first wins and repeating is idempotent", async () => {
  const local = { id: "collision", text: "  MILK ", completed: true, category: "Home", extra: "keep me" };
  const app = setup([local]);
  const data = envelope([
    { id: "remote", text: "milk", completed: false, category: "Skipped category" },
    { id: "collision", text: "  Bread ", completed: true, category: " home " },
    { id: "collision", text: "BREAD", completed: false, category: "Discarded" },
    { id: "collision", text: "Tea", completed: false, category: "Shop" },
    { id: "collision", text: "Coffee", completed: true, category: "SHOP" }
  ]);
  app.ids.importList.click();
  await app.preview(importFile(data));
  app.confirm();
  const imported = app.snapshot();
  assert.deepEqual(imported[0], local);
  assert.deepEqual(imported.slice(1).map(({ id, ...fields }) => fields), [
    { text: "  Bread ", completed: true, category: "Home" },
    { text: "Tea", completed: false, category: "Shop" },
    { text: "Coffee", completed: true, category: "Shop" }
  ]);
  assert.equal(new Set(imported.map((task) => task.id)).size, 4);
  assert.ok(imported.slice(1).every((task) => task.id !== "collision"));
  assert.deepEqual(plain(app.run("getCategories()")), ["Home", "Shop"]);
  assert.equal(app.ids.appStatus.hidden, true);
  const saved = app.storage.get("task-done-items"), writes = app.writes.length;
  app.ids.importList.click();
  await app.preview(importFile(data));
  assert.match(app.ids.importFeedback.textContent, /0 will be added; 5 matching or repeated names will be skipped.*Nothing new to import/);
  assert.equal(app.ids.confirmImport.disabled, true);
  app.confirm();
  unchanged(app, imported, saved);
  assert.equal(app.writes.length, writes);
  assert.equal(app.ids.importDialog.open, true);
});

test("preview counts every incoming item/state/category but never writes; cancel resets and restores focus", async () => {
  const app = setup([{ id: "local", text: "Milk", completed: true, category: "Home" }]);
  const before = app.snapshot(), saved = app.storage.get("task-done-items");
  app.ids.transferMenuButton.click();
  app.ids.importList.click();
  assert.equal(app.transferOptions.hidden, true);
  assert.equal(app.ids.importDialog.open, true);
  assert.equal(app.document.activeElement, app.ids.importFile);
  assertImportReset(app);
  const data = envelope([
    { id: "m", text: " milk ", completed: false, category: "Skipped" },
    { id: "b", text: "Bread", completed: true, category: " home " },
    { id: "dup", text: "BREAD", completed: false, category: "HOME" },
    { id: "c", text: "Coffee", completed: false, category: null }
  ]);
  await app.preview(importFile(data));
  assert.equal(app.ids.importFeedback.textContent,
    "4 items: 3 pending, 1 completed, 2 categories. 2 will be added; 2 matching or repeated names will be skipped. Your existing items will not change.");
  unchanged(app, before, saved);
  assert.equal(app.writes.length, 0);
  const pending = plain(app.run("pendingImport"));
  app.ids.importList.click();
  assert.deepEqual(plain(app.run("pendingImport")), pending, "opening an already open dialog preserves preview");
  app.ids.cancelImport.click();
  assert.equal(app.ids.importDialog.open, false);
  assertImportReset(app);
  assert.equal(app.document.activeElement, app.ids.transferMenuButton);
  assert.equal(app.ids.transferMenuButton.focusOptions.preventScroll, true);
  app.confirm();
  unchanged(app, before, saved);
  app.ids.importList.click();
  assertImportReset(app);
  await app.preview(importFile(data));
  assert.equal(app.ids.confirmImport.disabled, false, "same file can be previewed after cancellation");
});

test("empty import and cleared file selection cannot confirm or leave an old pending preview", async () => {
  const app = setup([item("local", null)]);
  const before = app.snapshot(), saved = app.storage.get("task-done-items");
  app.ids.importList.click();
  await app.preview(importFile(envelope()));
  assert.equal(app.ids.importFeedback.textContent,
    "0 items: 0 pending, 0 completed, 0 categories. 0 will be added; 0 matching or repeated names will be skipped. Nothing new to import.");
  app.confirm();
  assert.equal(app.ids.importDialog.open, true);
  await app.preview(importFile(envelope([item("new", null)])));
  assert.equal(app.ids.confirmImport.disabled, false);
  await app.preview(null);
  assertImportReset(app);
  app.confirm();
  unchanged(app, before, saved);
  assert.equal(app.writes.length, 0);
});

test("files above 5 MiB are rejected before reading; the exact boundary is read", async () => {
  const app = setup([item("local", null)]);
  const before = app.snapshot(), saved = app.storage.get("task-done-items");
  app.ids.importList.click();
  await app.preview(importFile(envelope([item("old", null)])));
  const oversized = importFile(envelope([item("new", null)]), {
    size: 5 * 1024 * 1024 + 1, text: () => { assert.fail("oversized file must not be read"); }
  });
  await app.preview(oversized);
  assert.equal(oversized.reads, 0);
  assert.match(app.ids.importFeedback.textContent, /too large.*up to 5 MB/);
  assert.equal(app.ids.confirmImport.disabled, true);
  assert.equal(app.run("pendingImport"), null);
  app.confirm();
  unchanged(app, before, saved);
  const boundary = importFile(envelope([item("boundary", null)]), { size: 5 * 1024 * 1024 });
  await app.preview(boundary);
  assert.equal(boundary.reads, 1);
  assert.equal(app.ids.confirmImport.disabled, false);
  assert.equal(app.writes.length, 0);
});

test("stale reads after close/reopen cannot replace the new preview or enable confirmation", async (t) => {
  for (const result of ["resolve", "reject"]) {
    await t.test(result, async () => {
      const app = setup();
      const read = deferred();
      app.ids.importList.click();
      const pending = app.preview(importFile("", { text: () => read.promise }));
      assert.equal(app.ids.importFeedback.textContent, "Reading list…");
      app.ids.cancelImport.click();
      assertImportReset(app);
      app.ids.importList.click();
      await app.preview(importFile(envelope([item("fresh", "Home")])));
      const feedback = app.ids.importFeedback.textContent;
      if (result === "resolve") read.resolve(JSON.stringify(envelope([item("stale", null)])));
      else read.reject(new Error("stale read error"));
      await pending;
      assert.equal(app.ids.importFeedback.textContent, feedback);
      assert.deepEqual(plain(app.run("pendingImport")), [item("fresh", "Home")]);
      assert.equal(app.ids.confirmImport.disabled, false);
      assert.equal(app.writes.length, 0);
      app.confirm();
      assert.deepEqual(app.snapshot().map((task) => task.text), ["Item fresh"]);
    });
  }
});

test("read completing while dialog remains closed is ignored and leaves reset state", async () => {
  const app = setup();
  app.ids.importList.click();
  const read = deferred();
  const pending = app.preview(importFile("", { text: () => read.promise }));
  app.ids.importDialog.close();
  read.resolve(JSON.stringify(envelope([item("late", null)])));
  await pending;
  assertImportReset(app);
  assert.equal(app.ids.importDialog.open, false);
  assert.deepEqual(app.snapshot(), []);
  assert.equal(app.writes.length, 0);
});

test("changing files invalidates earlier successes/errors and clearing selection invalidates active reads", async (t) => {
  for (const result of ["resolve", "reject", "clear"]) {
    await t.test(result, async () => {
      const app = setup();
      app.ids.importList.click();
      const read = deferred();
      const pending = app.preview(importFile("", { text: () => read.promise }));
      await app.preview(result === "clear" ? null : importFile(envelope([item("latest", null, true)])));
      const feedback = app.ids.importFeedback.textContent;
      if (result === "reject") read.reject(new Error("old error"));
      else read.resolve(JSON.stringify(envelope([item("old", "Wrong")])));
      await pending;
      assert.equal(app.ids.importFeedback.textContent, feedback);
      if (result === "clear") assertImportReset(app);
      else assert.deepEqual(plain(app.run("pendingImport")), [item("latest", null, true)]);
      assert.equal(app.writes.length, 0);
    });
  }
});

test("read errors discard a prior preview, retain tasks/storage and leave dialog open for retry", async () => {
  const app = setup([item("local", "Home", true)]);
  const before = app.snapshot(), saved = app.storage.get("task-done-items");
  app.ids.importList.click();
  await app.preview(importFile(envelope([item("old", null)])));
  app.run('globalThis.readFailure = new Error("Cannot read this file")');
  const file = importFile("", { text: () => Promise.reject(app.context.readFailure) });
  await app.preview(file);
  assert.equal(file.reads, 1);
  assert.equal(app.ids.importFeedback.textContent, "Cannot read this file");
  assert.equal(app.ids.importDialog.open, true);
  assert.equal(app.ids.confirmImport.disabled, true);
  assert.equal(app.run("pendingImport"), null);
  app.confirm();
  unchanged(app, before, saved);
  assert.equal(app.writes.length, 0);
  await app.preview(importFile(envelope([item("retry", null)])));
  assert.equal(app.ids.confirmImport.disabled, false);
});

test("setItem failure is atomic, preserves dialog/preview and allows a successful retry", async () => {
  const app = setup([item("local", "Home", true)]);
  const before = app.snapshot(), saved = app.storage.get("task-done-items"), card = app.cards()[0];
  app.ids.importList.click();
  await app.preview(importFile(envelope([item("new", null, true)])));
  const setItem = app.context.localStorage.setItem;
  app.run('localStorage.setItem = () => { throw new Error("Quota exceeded"); }');
  app.confirm();
  unchanged(app, before, saved);
  assert.equal(app.cards()[0], card, "failed persistence does not render a candidate list");
  assert.equal(app.ids.importDialog.open, true);
  assert.equal(app.ids.confirmImport.disabled, false);
  assert.deepEqual(plain(app.run("pendingImport")), [item("new", null, true)]);
  assert.match(app.ids.importFeedback.textContent, /could not be saved.*Nothing was imported/);
  assert.equal(app.ids.appStatus.hidden, false);
  assert.match(app.ids.appStatus.textContent, /Changes could not be saved/);
  assert.equal(app.consoleErrors.length, 1);
  app.context.localStorage.setItem = setItem;
  app.confirm();
  assert.equal(app.snapshot().length, 2);
  assert.deepEqual(app.snapshot()[0], before[0]);
  assert.deepEqual(JSON.parse(app.storage.get("task-done-items")), app.snapshot());
  assert.equal(app.ids.importDialog.open, false);
  assertImportReset(app);
  assert.equal(app.ids.appStatus.hidden, true);
});

test("ID generation failure before persistence keeps memory/storage unchanged and permits retry", async () => {
  const app = setup([item("local", null)]);
  const before = app.snapshot(), saved = app.storage.get("task-done-items");
  app.ids.importList.click();
  await app.preview(importFile(envelope([item("a", null), item("b", null)])));
  const crypto = app.context.crypto;
  app.run('crypto = { randomUUID: (() => { let calls = 0; return () => { if (++calls === 2) throw new Error("UUID unavailable"); return "unused-candidate"; }; })() }');
  app.confirm();
  unchanged(app, before, saved);
  assert.equal(app.writes.length, 0);
  assert.equal(app.ids.importDialog.open, true);
  assert.equal(app.ids.confirmImport.disabled, false);
  assert.match(app.ids.importFeedback.textContent, /could not be imported/);
  assert.equal(app.consoleErrors.length, 1);
  app.context.crypto = crypto;
  app.confirm();
  assert.equal(app.snapshot().length, 3);
});

test("double submit imports once; subsequent confirmation after close cannot write or rerender", async () => {
  const app = setup();
  app.ids.importList.click();
  await app.preview(importFile(envelope([item("incoming", null)])));
  app.confirm();
  const before = app.snapshot(), saved = app.storage.get("task-done-items"), card = app.cards()[0];
  const status = app.ids.appStatus.textContent;
  assert.equal(app.writes.length, 1);
  app.confirm();
  app.confirm();
  unchanged(app, before, saved);
  assert.equal(app.writes.length, 1);
  assert.equal(app.cards()[0], card);
  assert.equal(app.ids.appStatus.textContent, status);
  assertImportReset(app);
});

test("confirm replans against current tasks and category spelling instead of the preview snapshot", async () => {
  const app = setup([item("local", "Old", true)]);
  const incoming = envelope([
    { id: "collision", text: "Bread", completed: true, category: "Remote" },
    { id: "local", text: "Tea", completed: true, category: "NEW SHOP" }
  ]);
  app.ids.importList.click();
  await app.preview(importFile(incoming));
  assert.match(app.ids.importFeedback.textContent, /2 will be added; 0/);
  app.run('addTasks([" bread "]); tasks[tasks.length - 1].category = "New Shop"; toggleTask("local")');
  const current = app.snapshot();
  app.confirm();
  const merged = app.snapshot();
  assert.deepEqual(merged.slice(0, current.length), current);
  assert.equal(merged.length, current.length + 1);
  assert.equal(merged.at(-1).text, "Tea");
  assert.equal(merged.at(-1).completed, true);
  assert.equal(merged.at(-1).category, "New Shop");
  assert.equal(app.ids.appStatus.hidden, true);
  assert.deepEqual(JSON.parse(app.storage.get("task-done-items")), merged);
});

test("confirm with all names now present closes without attempting to save", async () => {
  const app = setup();
  app.ids.importList.click();
  await app.preview(importFile(envelope([{ id: "r", text: "Milk", completed: true, category: "Remote" }])));
  app.run('addTasks([" milk "])');
  const current = app.snapshot(), saved = app.storage.get("task-done-items"), writes = app.writes.length;
  app.run('localStorage.setItem = () => { throw new Error("must not write"); }');
  app.confirm();
  unchanged(app, current, saved);
  assert.equal(app.writes.length, writes);
  assert.equal(app.consoleErrors.length, 0);
  assert.equal(app.ids.importDialog.open, false);
  assert.equal(app.ids.appStatus.hidden, true);
  assertImportReset(app);
});

test("confirm includes names removed since preview rather than retaining stale skips", async () => {
  const app = setup([{ id: "local", text: "Milk", completed: false, category: "Home" }]);
  app.ids.importList.click();
  await app.preview(importFile(envelope([
    { id: "r", text: "Milk", completed: true, category: "Remote" }, item("new", null)
  ])));
  assert.match(app.ids.importFeedback.textContent, /1 will be added; 1/);
  app.run('deleteTask("local")');
  app.confirm();
  assert.deepEqual(app.snapshot().map(({ id, ...fields }) => fields), [
    { text: "Milk", completed: true, category: "Remote" },
    { text: "Item new", completed: false, category: null }
  ]);
  assert.equal(app.ids.appStatus.hidden, true);
});

test("export errors clean up resources, restore focus and never modify tasks/storage", async (t) => {
  for (const failure of ["Blob", "URL", "click"]) {
    await t.test(failure, () => {
      const app = setup([item("local", "Home", true)]);
      const before = app.snapshot(), saved = app.storage.get("task-done-items");
      if (failure === "Blob") app.run('Blob = class { constructor() { throw new Error("Blob unavailable"); } }');
      else if (failure === "URL") app.run('URL.createObjectURL = () => { throw new Error("URL unavailable"); }');
      else app.document.onDownload = () => { throw new Error("Download unavailable"); };
      app.ids.transferMenuButton.click();
      app.ids.exportList.click();
      unchanged(app, before, saved);
      assert.equal(app.writes.length, 0);
      assert.equal(app.document.body.querySelectorAll("a").length, 0);
      assert.equal(app.transferOptions.hidden, true);
      assert.equal(app.document.activeElement, app.ids.transferMenuButton);
      assert.equal(app.ids.transferMenuButton.focusOptions.preventScroll, true);
      assert.equal(app.ids.appStatus.hidden, false);
      assert.match(app.ids.appStatus.textContent, /could not be exported/);
      assert.equal(app.consoleErrors.length, 1);
      app.hold();
      assert.equal(app.objectURLs.size, 0);
      assert.equal(app.revokedURLs.length, failure === "click" ? 1 : 0);
    });
  }
});

test("nested transfer menu keyboard navigation, outside click and section menus share closing behavior", () => {
  const app = setup([item("local", null)]);
  assert.equal(app.ids.exportList.parent, app.transferOptions);
  assert.equal(app.ids.transferMenuButton.tagName, "button");
  app.ids.transferMenu.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(app.transferOptions.hidden, false);
  assert.equal(app.document.activeElement, app.ids.exportList);
  assert.equal(app.ids.transferMenuButton.attributes["aria-expanded"], "true");
  app.ids.transferMenu.dispatch("keydown", { key: "ArrowUp" });
  assert.equal(app.document.activeElement, app.ids.importList);
  app.ids.transferMenu.dispatch("keydown", { key: "Home" });
  assert.equal(app.document.activeElement, app.ids.exportList);
  app.ids.transferMenu.dispatch("keydown", { key: "End" });
  assert.equal(app.document.activeElement, app.ids.importList);
  app.ids.transferMenu.dispatch("keydown", { key: "Escape" });
  assert.equal(app.transferOptions.hidden, true);
  assert.equal(app.document.activeElement, app.ids.transferMenuButton);
  app.ids.transferMenuButton.click();
  const sectionMenu = app.ids.taskList.querySelector(".action-menu");
  sectionMenu.querySelector(".action-menu-button").click();
  assert.equal(app.transferOptions.hidden, true);
  assert.equal(sectionMenu.querySelector(".action-menu-options").hidden, false);
  app.ids.transferMenuButton.click();
  assert.equal(sectionMenu.querySelector(".action-menu-options").hidden, true);
  app.document.dispatch("click", { target: app.ids.taskInput });
  assert.equal(app.transferOptions.hidden, true);
  app.ids.transferMenuButton.click();
  app.ids.transferMenu.dispatch("keydown", { key: "Tab" });
  assert.equal(app.transferOptions.hidden, false);
  app.hold();
  assert.equal(app.transferOptions.hidden, true);
});
