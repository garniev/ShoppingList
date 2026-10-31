const STORAGE_KEY = "task-done-items";
const THEME_KEY = "theme-preference";
const VIEW_KEY = "task-view-preference";
const TRANSFER_FORMAT = "shopping-list";
const TRANSFER_VERSION = 1;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const themeToggle = document.getElementById("themeToggle");
const installButton = document.getElementById("installButton");
const categoryDialog = document.getElementById("categoryDialog");
const categorySelect = document.getElementById("categorySelect");
const newCategoryInput = document.getElementById("newCategory");
const appStatus = document.getElementById("appStatus");
const transferMenu = document.getElementById("transferMenu");
const transferMenuButton = document.getElementById("transferMenuButton");
const importDialog = document.getElementById("importDialog");
const importFile = document.getElementById("importFile");
const importFeedback = document.getElementById("importFeedback");
const confirmImport = document.getElementById("confirmImport");

function updateTaskFormStickyState() {
  if (taskForm.getBoundingClientRect().top <= 1) {
    taskForm.classList.add("is-sticky");
  } else {
    taskForm.classList.remove("is-sticky");
  }
}

window.addEventListener("scroll", updateTaskFormStickyState, { passive: true });
window.addEventListener("resize", updateTaskFormStickyState);
updateTaskFormStickyState();

let tasks = loadTasks();
let draggedTaskId = null;
let installPromptEvent = null;
let currentView = loadView();
let categoryTaskId = null;
let categoryReturnFocus = null;
let cancelPendingPress = () => {};
let pendingImport = null;
let importReadToken = 0;

function loadView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "categories" ? "categories" : "list";
  } catch {
    return "list";
  }
}

function persistValue(key, value) {
  try {
    localStorage.setItem(key, value);
    appStatus.hidden = true;
    return true;
  } catch (error) {
    appStatus.textContent = "Changes could not be saved on this device. Keep this page open to avoid losing them.";
    appStatus.hidden = false;
    console.error("Could not save changes:", error);
    return false;
  }
}

function normalizeCategory(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") || null : null;
}

function createListExport(items = tasks) {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    items: items.map(({ id, text, completed, category }) => ({
      id, text, completed, category: normalizeCategory(category)
    }))
  };
}

function parseListImport(contents) {
  let data;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error("This file is not valid JSON. Choose a list exported by this app.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.format !== TRANSFER_FORMAT) {
    throw new Error("This is not a Shopping List export.");
  }
  if (data.version !== TRANSFER_VERSION) {
    throw new Error("This export version is not supported. Update the app or request a new export.");
  }
  if (typeof data.exportedAt !== "string" || !Number.isFinite(Date.parse(data.exportedAt)) ||
      !Array.isArray(data.items)) {
    throw new Error("This export is incomplete or damaged.");
  }
  return data.items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.id !== "string" || !item.id.trim() ||
        typeof item.text !== "string" || !item.text.trim() ||
        typeof item.completed !== "boolean" ||
        !(item.category === null || (typeof item.category === "string" && normalizeCategory(item.category)))) {
      throw new Error(`Item ${index + 1} is invalid. Nothing has been imported.`);
    }
    // Only copy supported fields; imported text is rendered with textContent.
    return { id: item.id, text: item.text, completed: item.completed, category: normalizeCategory(item.category) };
  });
}

function planListImport(imported, existing = tasks) {
  const names = new Set(existing.map((item) => item.text.trim().toLocaleLowerCase("es")));
  const categories = new Map(existing.filter((item) => item.category)
    .map((item) => [item.category.toLocaleLowerCase("es"), item.category]));
  const additions = [];
  let skipped = 0;
  imported.forEach((item) => {
    const name = item.text.trim().toLocaleLowerCase("es");
    if (names.has(name)) {
      skipped++;
      return;
    }
    names.add(name);
    let category = normalizeCategory(item.category);
    if (category) {
      const key = category.toLocaleLowerCase("es");
      category = categories.get(key) || category;
      categories.set(key, category);
    }
    additions.push({ ...item, category });
  });
  return { additions, skipped };
}

function showTransferStatus(message) {
  appStatus.textContent = message;
  appStatus.hidden = false;
}

function exportList() {
  closeActionMenus();
  let url;
  let link;
  try {
    const data = createListExport();
    const filename = `shopping-list-${data.exportedAt.slice(0, 10)}.json`;
    url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } catch (error) {
    showTransferStatus("The list could not be exported. Please try again.");
    console.error("Could not export list:", error);
  } finally {
    link?.remove();
    // Allow browsers (including mobile browsers) to start reading the download.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    transferMenuButton.focus({ preventScroll: true });
  }
}

function resetImport() {
  importReadToken++;
  pendingImport = null;
  importFile.value = "";
  confirmImport.disabled = true;
  importFeedback.textContent = "Choose a file to preview its contents.";
}

function openImportDialog() {
  cancelPendingPress();
  closeActionMenus();
  if (importDialog.open) return;
  resetImport();
  importDialog.showModal();
  importFile.focus();
}

async function previewImportFile() {
  const token = ++importReadToken;
  pendingImport = null;
  confirmImport.disabled = true;
  const file = importFile.files?.[0];
  if (!file) {
    importFeedback.textContent = "Choose a file to preview its contents.";
    return;
  }
  importFeedback.textContent = "Reading list…";
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error("This file is too large. Choose a JSON export of up to 5 MB.");
    const contents = await file.text();
    if (token !== importReadToken || !importDialog.open) return;
    const imported = parseListImport(contents);
    const { additions, skipped } = planListImport(imported);
    const completed = imported.filter((item) => item.completed).length;
    const categoryCount = new Set(imported.map((item) => item.category?.toLocaleLowerCase("es")).filter(Boolean)).size;
    importFeedback.textContent = `${imported.length} items: ${imported.length - completed} pending, ${completed} completed, ${categoryCount} categories. ` +
      `${additions.length} will be added; ${skipped} matching or repeated names will be skipped.` +
      (additions.length ? " Your existing items will not change." : " Nothing new to import.");
    pendingImport = imported;
    confirmImport.disabled = additions.length === 0;
  } catch (error) {
    if (token !== importReadToken || !importDialog.open) return;
    importFeedback.textContent = error instanceof Error ? error.message : "The file could not be read. Please try again.";
  }
}

function confirmListImport(event) {
  event.preventDefault();
  if (!importDialog.open || !pendingImport || confirmImport.disabled) return;
  confirmImport.disabled = true;
  try {
    // Recheck against the current list, not the snapshot used for the preview.
    const { additions, skipped } = planListImport(pendingImport);
    if (additions.length) {
      const candidate = [...tasks, ...additions.map((item) => ({ ...item, id: crypto.randomUUID() }))];
      if (!persistValue(STORAGE_KEY, JSON.stringify(candidate))) {
        importFeedback.textContent = "The list could not be saved on this device. Nothing was imported. Free some storage and try again.";
        confirmImport.disabled = false;
        return;
      }
      tasks = candidate;
      renderTasks();
    }
    importDialog.close();
  } catch (error) {
    importFeedback.textContent = "The list could not be imported. Please try again.";
    confirmImport.disabled = false;
    console.error("Could not import list:", error);
  }
}

transferMenuButton.addEventListener("click", () => toggleActionMenu(transferMenu));
document.getElementById("exportList").addEventListener("click", exportList);
document.getElementById("importList").addEventListener("click", openImportDialog);
importFile.addEventListener("change", previewImportFile);
document.getElementById("importForm").addEventListener("submit", confirmListImport);
document.getElementById("cancelImport").addEventListener("click", () => importDialog.close());
importDialog.addEventListener("close", () => {
  resetImport();
  transferMenuButton.focus({ preventScroll: true });
});

// Support the standard arrow-key navigation pattern for the global menu.
transferMenu.addEventListener("keydown", (event) => {
  const options = transferMenu.querySelector(".action-menu-options");
  const buttons = [...options.querySelectorAll("button")];
  if (event.key === "Escape") {
    closeActionMenus();
    transferMenuButton.focus({ preventScroll: true });
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (options.hidden) toggleActionMenu(transferMenu);
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      event.key === "ArrowDown" ? (index + 1) % buttons.length : (index <= 0 ? buttons.length : index) - 1;
    buttons[next].focus();
  } else if (event.key === "Tab") {
    // Let the browser move focus before hiding the menu.
    setTimeout(closeActionMenus, 0);
  }
});

function getCategories() {
  return [...new Set(tasks.map((task) => task.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function openCategoryDialog(taskId, trigger) {
  cancelPendingPress();
  if (categoryDialog.open) return;
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  closeActionMenus();
  categoryTaskId = taskId;
  categoryReturnFocus = trigger;
  document.getElementById("categoryTaskName").textContent = task.text;
  categorySelect.replaceChildren(new Option("Uncategorized", ""));
  getCategories().forEach((category) => categorySelect.add(new Option(category, category)));
  categorySelect.value = task.category || "";
  newCategoryInput.value = "";
  newCategoryInput.setCustomValidity("");
  categoryDialog.showModal();
  categorySelect.focus();
}

document.getElementById("categoryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const typedName = normalizeCategory(newCategoryInput.value);
  if (newCategoryInput.value && !typedName) {
    newCategoryInput.setCustomValidity("Enter a category name or leave this field empty.");
    newCategoryInput.reportValidity();
    return;
  }
  const name = typedName || categorySelect.value || null;
  const category = getCategories().find((existing) =>
    existing.toLocaleLowerCase("es") === name?.toLocaleLowerCase("es")
  ) || name;
  tasks = tasks.map((task) => task.id === categoryTaskId ? { ...task, category } : task);
  saveTasks();
  renderTasks();
  categoryDialog.close();
});

newCategoryInput.addEventListener("input", () => newCategoryInput.setCustomValidity(""));
document.getElementById("cancelCategory").addEventListener("click", () => categoryDialog.close());
categoryDialog.addEventListener("close", () => {
  const card = [...taskList.querySelectorAll(".task")]
    .find((element) => element.dataset.taskId === categoryTaskId);
  const target = categoryReturnFocus?.isConnected
    ? categoryReturnFocus : card?.querySelector(".category-button") || taskInput;
  target.focus();
  categoryTaskId = null;
  categoryReturnFocus = null;
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    currentView = button.dataset.view;
    persistValue(VIEW_KEY, currentView);
    renderTasks();
  });
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Could not register service worker:", error);
    });
  });
}

function setupInstallPrompt() {
  if (!installButton) {
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPromptEvent = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!installPromptEvent) {
      return;
    }

    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    installButton.hidden = true;
  });
}

registerServiceWorker();
setupInstallPrompt();

// Theme initialization - dark mode by default
function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const isDark = savedTheme !== "light";

  if (isDark) {
    document.body.classList.remove("light-mode");
    themeToggle.textContent = "☀️";
  } else {
    document.body.classList.add("light-mode");
    themeToggle.textContent = "🌙";
  }
}

function toggleTheme() {
  const isCurrentlyLight = document.body.classList.contains("light-mode");
  if (isCurrentlyLight) {
    document.body.classList.remove("light-mode");
    localStorage.setItem(THEME_KEY, "dark");
    themeToggle.textContent = "☀️";
  } else {
    document.body.classList.add("light-mode");
    localStorage.setItem(THEME_KEY, "light");
    themeToggle.textContent = "🌙";
  }
}

themeToggle.addEventListener("click", toggleTheme);
initTheme();

function loadTasks() {
  try {
    const savedTasks = localStorage.getItem(STORAGE_KEY);

    const parsed = savedTasks ? JSON.parse(savedTasks) : [];
    if (!Array.isArray(parsed)) return [];
    const categoryNames = new Map();
    return parsed.filter((task) => task && typeof task.id === "string" &&
      typeof task.text === "string" && typeof task.completed === "boolean")
      .map((task) => {
        let category = normalizeCategory(task.category);
        if (category) {
          const key = category.toLocaleLowerCase("es");
          category = categoryNames.get(key) || category;
          categoryNames.set(key, category);
        }
        return { ...task, category };
      });
  } catch (error) {
    console.error("Could not load items:", error);
    return [];
  }
}

function saveTasks() {
  persistValue(STORAGE_KEY, JSON.stringify(tasks));
}

function addTasks(texts) {
  const newTasks = [];

  texts.forEach((text) => {
    const normalizedText = text.trim().toLocaleLowerCase("es");
    const existingTask = tasks.find(
      (task) =>
        task.text.trim().toLocaleLowerCase("es") === normalizedText
    );

    if (existingTask) {
      existingTask.completed = false;
      return;
    }

    newTasks.push({
      id: crypto.randomUUID(),
      text,
      completed: false,
      category: null
    });
  });

  tasks.push(...newTasks);
  saveTasks();
  renderTasks();
}

function getTaskTextsFromInput(value) {
  return value
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean);
}

function toggleTask(id) {
  const restoreFocus = document.activeElement?.closest(".task")?.dataset.taskId === id;
  tasks = tasks.map((task) =>
    task.id === id ? { ...task, completed: !task.completed } : task
  );

  saveTasks();
  renderTasks();
  if (restoreFocus) {
    [...taskList.querySelectorAll(".task")]
      .find((element) => element.dataset.taskId === id)?.querySelector(".task-text").focus({ preventScroll: true });
  }
}

function deleteTask(id) {
  tasks = tasks.filter((task) => task.id !== id);

  saveTasks();
  renderTasks();
}

function sortTasksAlphabetically(section) {
  const compareTasks = (firstTask, secondTask) =>
    firstTask.text.localeCompare(secondTask.text, "es", {
      sensitivity: "base"
    });

  tasks = tasks.map((task) => task);
  const sectionTasks = tasks
    .filter((task) => task.completed === section)
    .sort(compareTasks);
  let sectionIndex = 0;

  tasks = tasks.map((task) =>
    task.completed === section ? sectionTasks[sectionIndex++] : task
  );

  saveTasks();
  renderTasks();
}

function removeDuplicateTasks(section) {
  const seenTaskTexts = new Set();
  const uniqueTasks = [];

  for (const task of tasks) {
    if (task.completed !== section) {
      uniqueTasks.push(task);
      continue;
    }

    const normalizedText = task.text.trim().toLocaleLowerCase("es");

    if (seenTaskTexts.has(normalizedText)) {
      continue;
    }

    seenTaskTexts.add(normalizedText);
    uniqueTasks.push(task);
  }

  tasks = uniqueTasks;

  saveTasks();
  renderTasks();
}

function deleteAllTasks(section) {
  tasks = tasks.filter((task) => task.completed !== section);
  saveTasks();
  renderTasks();
}

function setAllTasksCompleted(completed) {
  tasks = tasks.map((task) =>
    task.completed === !completed ? { ...task, completed } : task
  );
  saveTasks();
  renderTasks();
}

function closeActionMenus() {
  document.querySelectorAll(".action-menu").forEach((menu) => {
    menu.querySelector(".action-menu-options").hidden = true;
    menu.querySelector(".action-menu-button").setAttribute("aria-expanded", "false");
  });
}

function toggleActionMenu(menu) {
  const options = menu.querySelector(".action-menu-options");
  const button = menu.querySelector(".action-menu-button");
  const shouldOpen = options.hidden;

  closeActionMenus();
  options.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));
}

function createActionMenu(section) {
  const menu = document.createElement("div");
  menu.className = "action-menu";

  const menuButton = document.createElement("button");
  menuButton.className = "action-menu-button";
  menuButton.type = "button";
  menuButton.textContent = "⋮";
  menuButton.setAttribute("aria-label", "More actions");
  menuButton.setAttribute("aria-haspopup", "true");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.title = "More actions";
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleActionMenu(menu);
  });

  const options = document.createElement("div");
  options.className = "action-menu-options";
  options.role = "menu";
  options.hidden = true;

  const actions = [
    ["Sort", "sort"],
    ["Clean", "clean"],
    [section ? "Uncheck all" : "Check all", section ? "uncheck-all" : "check-all"],
    ["Delete all", "delete-all"]
  ];

  actions.forEach(([label, action]) => {
    const option = document.createElement("button");
    option.type = "button";
    option.role = "menuitem";
    option.textContent = label;
    option.dataset.action = action;
    option.dataset.section = String(section);
    options.appendChild(option);
  });

  menu.append(menuButton, options);
  return menu;
}

function getOrderedTasks() {
  const pending = tasks.filter((task) => !task.completed);
  if (currentView === "categories") {
    pending.sort((a, b) => {
      if (a.category === b.category) return 0;
      if (!a.category) return 1;
      if (!b.category) return -1;
      return a.category.localeCompare(b.category, "es", { sensitivity: "base" });
    });
  }
  return [
    ...pending,
    ...tasks.filter((task) => task.completed)
  ];
}

function canMoveTask(draggedId, targetId) {
  const dragged = tasks.find((task) => task.id === draggedId);
  const target = tasks.find((task) => task.id === targetId);
  return Boolean(dragged && target && draggedId !== targetId &&
    (currentView !== "categories" ||
      (dragged.completed === target.completed &&
        (dragged.completed || dragged.category === target.category))));
}

function moveTask(draggedId, targetId, insertBefore) {
  if (!canMoveTask(draggedId, targetId)) return;
  const orderedTasks = [...tasks];
  const draggedIndex = orderedTasks.findIndex((task) => task.id === draggedId);
  const targetIndex = orderedTasks.findIndex((task) => task.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }

  const targetTask = orderedTasks[targetIndex];
  const [draggedTask] = orderedTasks.splice(draggedIndex, 1);
  const adjustedTargetIndex = orderedTasks.findIndex((task) => task.id === targetId);
  const insertionIndex = insertBefore
    ? adjustedTargetIndex
    : adjustedTargetIndex + 1;
  draggedTask.completed = targetTask.completed;
  orderedTasks.splice(insertionIndex, 0, draggedTask);
  tasks = orderedTasks;

  saveTasks();
  renderTasks();
}

function clearDropIndicators() {
  document.querySelectorAll(".task.drop-before, .task.drop-after").forEach((taskElement) => {
    taskElement.classList.remove("drop-before", "drop-after");
  });
}

// Keep native scrolling; cancel the hold as soon as the pointer moves.
function setupLongPress(element, taskId) {
  let timer = null;
  let origin = null;
  let suppressClick = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    origin = null;
  };
  element.addEventListener("pointerdown", (event) => {
    suppressClick = false;
    if (!event.isPrimary || event.button !== 0 || event.target.closest("button:not([data-hold-target])")) return;
    cancelPendingPress();
    origin = { x: event.clientX, y: event.clientY, id: event.pointerId };
    cancelPendingPress = cancel;
    timer = setTimeout(() => {
      suppressClick = true;
      openCategoryDialog(taskId, element.querySelector(".category-button"));
    }, 500);
  });
  element.addEventListener("pointermove", (event) => {
    if (origin && (origin.id !== event.pointerId ||
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10)) cancel();
  });
  ["pointerup", "pointercancel", "pointerleave", "dragstart"].forEach((name) =>
    element.addEventListener(name, cancel));
  element.addEventListener("click", (event) => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  element.addEventListener("contextmenu", (event) => {
    if (event.target.closest("button:not([data-hold-target])")) return;
    event.preventDefault();
    suppressClick = true;
    openCategoryDialog(taskId, element.querySelector(".category-button"));
  });
}

window.addEventListener("blur", () => cancelPendingPress());
document.addEventListener("scroll", () => cancelPendingPress(), true);
document.addEventListener("visibilitychange", () => cancelPendingPress());

function renderTasks() {
  cancelPendingPress();
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === currentView));
  });
  taskList.innerHTML = "";

  if (tasks.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        You have no items yet.
      </div>
    `;
    return;
  }

  const orderedTasks = getOrderedTasks();
  let completedHeaderAdded = false;
  let activeHeaderAdded = false;
  let previousCategory;
  const activeTaskCount = tasks.filter((task) => !task.completed).length;
  const completedTaskCount = tasks.filter((task) => task.completed).length;

  orderedTasks.forEach((task) => {
    if (!task.completed && !activeHeaderAdded) {
      const activeHeader = document.createElement("div");
      activeHeader.className = "task-group-header";
      const activeTitle = document.createElement("span");
      activeTitle.textContent = `To Buy (${activeTaskCount})`;
      activeHeader.append(activeTitle, createActionMenu(false));
      taskList.appendChild(activeHeader);
      activeHeaderAdded = true;
    }

    if (task.completed && !completedHeaderAdded) {
      const completedHeader = document.createElement("div");
      completedHeader.className = "task-group-header";
      const completedTitle = document.createElement("span");
      completedTitle.textContent = `Bought (${completedTaskCount})`;
      completedHeader.append(completedTitle, createActionMenu(true));
      taskList.appendChild(completedHeader);
      completedHeaderAdded = true;
    }

    if (!task.completed && currentView === "categories" && previousCategory !== task.category) {
      const categoryHeader = document.createElement("h2");
      categoryHeader.className = "category-group-header";
      const count = tasks.filter((item) => !item.completed && item.category === task.category).length;
      categoryHeader.textContent = `${task.category || "Uncategorized"} (${count})`;
      taskList.appendChild(categoryHeader);
      previousCategory = task.category;
    }

    const taskElement = document.createElement("div");
    taskElement.draggable = true;
    taskElement.dataset.taskId = task.id;

    taskElement.className = `task ${task.completed ? "completed" : ""}`;
    setupLongPress(taskElement, task.id);

    taskElement.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }

      toggleTask(task.id);
    });

    taskElement.addEventListener("dragstart", (event) => {
      draggedTaskId = task.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", task.id);
      taskElement.classList.add("dragging");
    });

    taskElement.addEventListener("dragover", (event) => {
      if (!canMoveTask(draggedTaskId, task.id)) {
        clearDropIndicators();
        return;
      }

      event.preventDefault();
      clearDropIndicators();

      const insertBefore =
        event.clientY <
        taskElement.getBoundingClientRect().top +
          taskElement.getBoundingClientRect().height / 2;

      taskElement.classList.add(insertBefore ? "drop-before" : "drop-after");
    });

    taskElement.addEventListener("drop", (event) => {
      event.preventDefault();

      if (!canMoveTask(draggedTaskId, task.id)) {
        return;
      }

      const bounds = taskElement.getBoundingClientRect();
      const insertBefore = event.clientY < bounds.top + bounds.height / 2;

      moveTask(draggedTaskId, task.id, insertBefore);
      draggedTaskId = null;
    });

    taskElement.addEventListener("dragend", () => {
      draggedTaskId = null;
      clearDropIndicators();
      taskElement.classList.remove("dragging");
    });

    const content = document.createElement("div");
    content.className = "task-content";
    const text = document.createElement("button");
    text.type = "button";
    text.className = "task-text";
    text.textContent = task.text;
    text.setAttribute("aria-pressed", String(task.completed));
    text.setAttribute("aria-label", `${task.completed ? "Uncheck" : "Complete"}: ${task.text}`);
    text.addEventListener("click", () => toggleTask(task.id));
    // Text is also the primary hold target, unlike the action buttons.
    text.dataset.holdTarget = "true";

    const categoryButton = document.createElement("button");
    categoryButton.className = "category-button";
    categoryButton.type = "button";
    categoryButton.textContent = task.category || "Uncategorized";
    categoryButton.setAttribute("aria-label", `Assign category for ${task.text}. Current: ${task.category || "Uncategorized"}`);
    categoryButton.addEventListener("click", () => openCategoryDialog(task.id, categoryButton));
    content.append(text, categoryButton);

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "🗑";
    deleteButton.setAttribute("aria-label", "Delete item");
    deleteButton.setAttribute("title", "Delete item");

    deleteButton.addEventListener("click", () => {
      deleteTask(task.id);
    });

    taskElement.appendChild(content);
    taskElement.appendChild(deleteButton);

    taskList.appendChild(taskElement);
  });
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const taskTexts = getTaskTextsFromInput(taskInput.value);

  if (taskTexts.length === 0) {
    return;
  }

  addTasks(taskTexts);

  taskInput.value = "";
  taskInput.focus();
});

taskList.addEventListener("click", (event) => {
  const option = event.target.closest("[data-action]");

  if (!option) {
    return;
  }

  const section = option.dataset.section === "true";

  switch (option.dataset.action) {
    case "sort":
      sortTasksAlphabetically(section);
      break;
    case "clean":
      removeDuplicateTasks(section);
      break;
    case "delete-all":
      deleteAllTasks(section);
      break;
    case "check-all":
      setAllTasksCompleted(true);
      break;
    case "uncheck-all":
      setAllTasksCompleted(false);
      break;
    default:
      return;
  }

  closeActionMenus();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-menu")) {
    closeActionMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeActionMenus();
  }
});

renderTasks();