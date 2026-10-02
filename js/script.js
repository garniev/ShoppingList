const STORAGE_KEY = "task-done-items";
const THEME_KEY = "theme-preference";

const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const themeToggle = document.getElementById("themeToggle");
const installButton = document.getElementById("installButton");

let tasks = loadTasks();
let draggedTaskId = null;
let installPromptEvent = null;

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

    return savedTasks ? JSON.parse(savedTasks) : [];
  } catch (error) {
    console.error("Could not load items:", error);
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function addTasks(texts) {
  const newTasks = texts.map((text) => ({
    id: crypto.randomUUID(),
    text,
    completed: false
  }));

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
  tasks = tasks.map((task) =>
    task.id === id ? { ...task, completed: !task.completed } : task
  );

  saveTasks();
  renderTasks();
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
  return [
    ...tasks.filter((task) => !task.completed),
    ...tasks.filter((task) => task.completed)
  ];
}

function moveTask(draggedId, targetId, insertBefore) {
  const orderedTasks = getOrderedTasks();
  const draggedIndex = orderedTasks.findIndex((task) => task.id === draggedId);
  const targetIndex = orderedTasks.findIndex((task) => task.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }

  const [draggedTask] = orderedTasks.splice(draggedIndex, 1);
  const adjustedTargetIndex = orderedTasks.findIndex((task) => task.id === targetId);
  const insertionIndex = insertBefore
    ? adjustedTargetIndex
    : adjustedTargetIndex + 1;
  const activeTaskCount = orderedTasks.filter((task) => !task.completed).length;

  draggedTask.completed = insertionIndex > activeTaskCount;
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

function renderTasks() {
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

    const taskElement = document.createElement("div");
    taskElement.draggable = true;
    taskElement.dataset.taskId = task.id;

    taskElement.className = `task ${task.completed ? "completed" : ""}`;

    taskElement.addEventListener("click", (event) => {
      if (event.target.closest(".delete-button")) {
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
      if (!draggedTaskId || draggedTaskId === task.id) {
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

      if (!draggedTaskId || draggedTaskId === task.id) {
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

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "🗑";
    deleteButton.setAttribute("aria-label", "Delete item");
    deleteButton.setAttribute("title", "Delete item");

    deleteButton.addEventListener("click", () => {
      deleteTask(task.id);
    });

    taskElement.appendChild(text);
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