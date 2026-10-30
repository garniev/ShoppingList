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
      add: () => {}, remove: () => {}, contains: () => false
    };
  }
  set innerHTML(value) {
    for (const child of this.children) child.disconnect();
    this.children = [];
    this.html = value;
  }
  disconnect() {
    this.isConnected = false;
    this.children.forEach((child) => child.disconnect());
  }
  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }
  appendChild(child) {
    child.parent = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
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
    if (selector === "button") return this.tagName === "button";
    if (selector === "button:not([data-hold-target])") {
      return this.tagName === "button" && !this.dataset.holdTarget;
    }
    if (selector === "[data-view]") return Boolean(this.dataset.view);
    return selector.startsWith(".") && this.className.split(" ").includes(selector.slice(1));
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
  focus() { this.document.activeElement = this; }
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
  const ids = {};
  for (const id of ["taskForm", "taskInput", "taskList", "themeToggle", "installButton",
    "categoryDialog", "categorySelect", "newCategory", "appStatus", "categoryTaskName",
    "categoryForm", "cancelCategory"]) {
    ids[id] = new Element("div", document);
    document.append(ids[id]);
  }
  document.getElementById = (id) => ids[id];
  document.createElement = (tag) => new Element(tag, document);
  for (const value of ["list", "categories"]) {
    const button = new Element("button", document);
    button.dataset.view = value;
    document.append(button);
  }
  let nextTimer = 0;
  const timers = new Map();
  const context = vm.createContext({
    document, navigator: {}, console, crypto: require("node:crypto").webcrypto,
    window: new Element("window", document),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
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
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "../js/script.js"), "utf8"), context);
  return {
    ids, storage, document, context,
    run: (source) => vm.runInContext(source, context),
    snapshot: () => JSON.parse(vm.runInContext("JSON.stringify(tasks)", context)),
    hold: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); },
    cards: () => ids.taskList.querySelectorAll(".task"),
    assign(id, name) {
      vm.runInContext(`openCategoryDialog(${JSON.stringify(id)}, taskInput)`, context);
      ids.newCategory.value = name;
      ids.categoryForm.dispatch("submit");
    }
  };
}

const item = (id, category, completed = false) => ({ id, text: `Item ${id}`, completed, ...(category === undefined ? {} : { category }) });

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