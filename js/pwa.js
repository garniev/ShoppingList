function updateTaskFormStickyState() {
  const taskForm = document.getElementById("taskForm");
  if (taskForm.getBoundingClientRect().top <= 1) {
    taskForm.classList.add("is-sticky");
  } else {
    taskForm.classList.remove("is-sticky");
  }
}

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
  const installButton = document.getElementById("installButton");
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

function initTheme() {
  const themeToggle = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem("theme-preference");
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
  const themeToggle = document.getElementById("themeToggle");
  const isCurrentlyLight = document.body.classList.contains("light-mode");
  if (isCurrentlyLight) {
    document.body.classList.remove("light-mode");
    localStorage.setItem("theme-preference", "dark");
    themeToggle.textContent = "☀️";
  } else {
    document.body.classList.add("light-mode");
    localStorage.setItem("theme-preference", "light");
    themeToggle.textContent = "🌙";
  }
}

window.addEventListener("scroll", updateTaskFormStickyState, { passive: true });
window.addEventListener("resize", updateTaskFormStickyState);
window.addEventListener("blur", () => cancelPendingPress());
document.addEventListener("scroll", () => cancelPendingPress(), true);
document.addEventListener("visibilitychange", () => cancelPendingPress());
document.getElementById("themeToggle").addEventListener("click", toggleTheme);

registerServiceWorker();
setupInstallPrompt();
initTheme();
updateTaskFormStickyState();