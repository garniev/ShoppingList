const TRANSFER_FORMAT = "shopping-list";
const TRANSFER_VERSION = 1;

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