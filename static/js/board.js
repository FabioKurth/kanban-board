/**
 * Kanban Board — Frontend-Logik
 *
 * Verwaltet Rendering, Drag & Drop, Suche, Filter,
 * Statistik-Panel und Dark/Light Theme Toggle.
 */

// ── State ─────────────────────────────────────────────────────────────
let boardData = [];
let draggedCard = null;
let selectedLabel = "";

// ── DOM-Referenzen ────────────────────────────────────────────────────
const board = document.getElementById("board");
const cardModal = document.getElementById("cardModal");
const cardForm = document.getElementById("cardForm");
const modalTitle = document.getElementById("modalTitle");
const deleteCardBtn = document.getElementById("deleteCardBtn");
const searchInput = document.getElementById("searchInput");
const filterPriority = document.getElementById("filterPriority");
const filterLabel = document.getElementById("filterLabel");
const statsPanel = document.getElementById("statsPanel");
const statsOverlay = document.getElementById("statsOverlay");

// ── API-Helper ────────────────────────────────────────────────────────

async function api(endpoint, method = "GET", body = null) {
    const options = {
        method,
        headers: { "Content-Type": "application/json" },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`/api${endpoint}`, options);
    return response.json();
}

// ── Board rendern ─────────────────────────────────────────────────────

async function loadBoard() {
    boardData = await api("/columns");
    renderBoard();
    applyFilters();
}

function renderBoard() {
    board.innerHTML = "";
    boardData.forEach((column) => {
        board.appendChild(createColumnElement(column));
    });
}

function createColumnElement(column) {
    const el = document.createElement("div");
    el.className = "column";
    el.dataset.columnId = column.id;

    el.innerHTML = `
        <div class="column-header">
            <div class="column-title">
                <h3>${escapeHtml(column.title)}</h3>
                <span class="card-count">${column.cards.length}</span>
            </div>
            <div class="column-actions">
                <button class="column-btn" onclick="renameColumn(${column.id}, '${escapeHtml(column.title)}')" title="Rename">&#9998;</button>
                <button class="column-btn" onclick="deleteColumn(${column.id})" title="Delete">&times;</button>
            </div>
        </div>
        <div class="card-list" data-column-id="${column.id}"></div>
        <button class="add-card-btn" onclick="openModal(${column.id})">+ Add Card</button>
    `;

    const cardList = el.querySelector(".card-list");
    column.cards.forEach((card) => {
        cardList.appendChild(createCardElement(card));
    });

    setupDropZone(cardList);
    return el;
}

function createCardElement(card) {
    const el = document.createElement("div");
    el.className = "card";
    el.draggable = true;
    el.dataset.cardId = card.id;
    el.dataset.priority = card.priority || "medium";
    el.dataset.cardLabel = card.label || "";
    el.dataset.title = (card.title || "").toLowerCase();
    el.dataset.description = (card.description || "").toLowerCase();
    if (card.label) el.dataset.label = card.label;

    // Due Date Badge erstellen
    let dueBadgeHtml = "";
    if (card.due_date) {
        const dueInfo = getDueInfo(card.due_date);
        dueBadgeHtml = `<span class="due-badge ${dueInfo.cls}">${dueInfo.text}</span>`;
    }

    // Priority Badge
    const priorityHtml = `<span class="priority-badge ${card.priority}">${card.priority}</span>`;

    el.innerHTML = `
        <div class="card-title">${escapeHtml(card.title)}</div>
        ${card.description ? `<div class="card-description">${escapeHtml(card.description)}</div>` : ""}
        <div class="card-footer">
            ${priorityHtml}
            ${dueBadgeHtml}
        </div>
    `;

    el.addEventListener("click", (e) => {
        if (!el.classList.contains("dragging")) {
            openModal(card.column_id, card);
        }
    });

    el.addEventListener("dragstart", handleDragStart);
    el.addEventListener("dragend", handleDragEnd);

    return el;
}

// ── Due Date Helper ───────────────────────────────────────────────────

function getDueInfo(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dateStr + "T00:00:00");
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        return { cls: "overdue", text: `${Math.abs(diffDays)}d overdue` };
    } else if (diffDays === 0) {
        return { cls: "due-soon", text: "Due today" };
    } else if (diffDays <= 3) {
        return { cls: "due-soon", text: `Due in ${diffDays}d` };
    } else {
        const formatted = due.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
        return { cls: "upcoming", text: formatted };
    }
}

// ── Search & Filter ───────────────────────────────────────────────────

function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const priority = filterPriority.value;
    const label = filterLabel.value;

    document.querySelectorAll(".card").forEach((card) => {
        const matchesSearch = !query
            || card.dataset.title.includes(query)
            || card.dataset.description.includes(query);
        const matchesPriority = !priority || card.dataset.priority === priority;
        const matchesLabel = !label || card.dataset.cardLabel === label;

        card.classList.toggle("hidden", !(matchesSearch && matchesPriority && matchesLabel));
    });

    // Card-Count aktualisieren
    document.querySelectorAll(".column").forEach((col) => {
        const visible = col.querySelectorAll(".card:not(.hidden)").length;
        col.querySelector(".card-count").textContent = visible;
    });
}

searchInput.addEventListener("input", applyFilters);
filterPriority.addEventListener("change", applyFilters);
filterLabel.addEventListener("change", applyFilters);

// ── Drag & Drop ───────────────────────────────────────────────────────

function handleDragStart(e) {
    draggedCard = e.target.closest(".card");
    draggedCard.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", draggedCard.dataset.cardId);

    requestAnimationFrame(() => {
        draggedCard.style.opacity = "0.4";
    });
}

function handleDragEnd() {
    if (draggedCard) {
        draggedCard.classList.remove("dragging");
        draggedCard.style.opacity = "";
        draggedCard = null;
    }
    document.querySelectorAll(".drop-placeholder").forEach((el) => el.remove());
    document.querySelectorAll(".column.drag-over").forEach((el) => el.classList.remove("drag-over"));
}

function setupDropZone(cardList) {
    cardList.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        cardList.closest(".column").classList.add("drag-over");

        const afterElement = getDragAfterElement(cardList, e.clientY);
        const placeholder = cardList.querySelector(".drop-placeholder") || createPlaceholder();

        if (afterElement) {
            cardList.insertBefore(placeholder, afterElement);
        } else {
            cardList.appendChild(placeholder);
        }
    });

    cardList.addEventListener("dragleave", (e) => {
        if (!cardList.contains(e.relatedTarget)) {
            cardList.closest(".column").classList.remove("drag-over");
            const placeholder = cardList.querySelector(".drop-placeholder");
            if (placeholder) placeholder.remove();
        }
    });

    cardList.addEventListener("drop", async (e) => {
        e.preventDefault();
        cardList.closest(".column").classList.remove("drag-over");

        const placeholder = cardList.querySelector(".drop-placeholder");
        if (!draggedCard || !placeholder) return;

        const cardId = parseInt(draggedCard.dataset.cardId);
        const targetColumnId = parseInt(cardList.dataset.columnId);
        const targetPosition = [...cardList.children].indexOf(placeholder);

        placeholder.remove();

        await api("/cards/move", "PUT", {
            card_id: cardId,
            target_column_id: targetColumnId,
            target_position: targetPosition,
        });

        await loadBoard();
    });
}

function getDragAfterElement(cardList, y) {
    const cards = [...cardList.querySelectorAll(".card:not(.dragging):not(.drop-placeholder)")];
    return cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function createPlaceholder() {
    const el = document.createElement("div");
    el.className = "drop-placeholder";
    return el;
}

// ── Modal ─────────────────────────────────────────────────────────────

function openModal(columnId, card = null) {
    document.getElementById("cardColumnId").value = columnId;
    selectedLabel = "";

    if (card) {
        modalTitle.textContent = "Edit Card";
        document.getElementById("cardId").value = card.id;
        document.getElementById("cardTitleInput").value = card.title;
        document.getElementById("cardDescription").value = card.description || "";
        document.getElementById("cardPriority").value = card.priority || "medium";
        document.getElementById("cardDueDate").value = card.due_date || "";
        selectedLabel = card.label || "";
        deleteCardBtn.style.display = "block";
    } else {
        modalTitle.textContent = "New Card";
        document.getElementById("cardId").value = "";
        document.getElementById("cardTitleInput").value = "";
        document.getElementById("cardDescription").value = "";
        document.getElementById("cardPriority").value = "medium";
        document.getElementById("cardDueDate").value = "";
        deleteCardBtn.style.display = "none";
    }

    updateLabelPicker();
    cardModal.classList.add("active");
    setTimeout(() => document.getElementById("cardTitleInput").focus(), 100);
}

function closeModal() {
    cardModal.classList.remove("active");
}

function updateLabelPicker() {
    document.querySelectorAll(".label-dot").forEach((dot) => {
        dot.classList.toggle("selected", dot.dataset.label === selectedLabel);
    });
}

document.getElementById("labelPicker").addEventListener("click", (e) => {
    const dot = e.target.closest(".label-dot");
    if (!dot) return;
    selectedLabel = dot.dataset.label;
    updateLabelPicker();
});

document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("cancelBtn").addEventListener("click", closeModal);
cardModal.addEventListener("click", (e) => {
    if (e.target === cardModal) closeModal();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeModal();
        closeStats();
    }
});

// ── Formular: Karte speichern ─────────────────────────────────────────

cardForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const cardId = document.getElementById("cardId").value;
    const data = {
        title: document.getElementById("cardTitleInput").value.trim(),
        description: document.getElementById("cardDescription").value.trim(),
        column_id: parseInt(document.getElementById("cardColumnId").value),
        label: selectedLabel,
        priority: document.getElementById("cardPriority").value,
        due_date: document.getElementById("cardDueDate").value,
    };

    if (!data.title) return;

    if (cardId) {
        await api(`/cards/${cardId}`, "PUT", data);
    } else {
        await api("/cards", "POST", data);
    }

    closeModal();
    await loadBoard();
});

// ── Karte loeschen ────────────────────────────────────────────────────

deleteCardBtn.addEventListener("click", async () => {
    const cardId = document.getElementById("cardId").value;
    if (!cardId) return;

    await api(`/cards/${cardId}`, "DELETE");
    closeModal();
    await loadBoard();
});

// ── Spalten-Aktionen ──────────────────────────────────────────────────

document.getElementById("addColumnBtn").addEventListener("click", async () => {
    const title = prompt("Column name:");
    if (!title || !title.trim()) return;

    await api("/columns", "POST", { title: title.trim() });
    await loadBoard();
});

async function renameColumn(columnId, currentTitle) {
    const newTitle = prompt("Rename column:", currentTitle);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === currentTitle) return;

    await api(`/columns/${columnId}`, "PUT", { title: newTitle.trim() });
    await loadBoard();
}

async function deleteColumn(columnId) {
    if (!confirm("Delete this column and all its cards?")) return;

    await api(`/columns/${columnId}`, "DELETE");
    await loadBoard();
}

// ── Stats Panel ───────────────────────────────────────────────────────

document.getElementById("statsToggle").addEventListener("click", toggleStats);
document.getElementById("statsClose").addEventListener("click", closeStats);
statsOverlay.addEventListener("click", closeStats);

function toggleStats() {
    const isActive = statsPanel.classList.contains("active");
    if (isActive) {
        closeStats();
    } else {
        openStats();
    }
}

async function openStats() {
    const stats = await api("/stats");
    renderStats(stats);
    statsPanel.classList.add("active");
    statsOverlay.classList.add("active");
}

function closeStats() {
    statsPanel.classList.remove("active");
    statsOverlay.classList.remove("active");
}

function renderStats(stats) {
    const content = document.getElementById("statsContent");
    const total = stats.total || 1;

    // Per Column Bars
    let columnBarsHtml = stats.per_column.map((col) => {
        const pct = total > 0 ? (col.count / total * 100) : 0;
        return `
            <div class="stat-bar-item">
                <div class="stat-bar-label">
                    <span>${escapeHtml(col.title)}</span>
                    <span>${col.count}</span>
                </div>
                <div class="stat-bar">
                    <div class="stat-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }).join("");

    // Priority Bars
    const priorities = ["high", "medium", "low"];
    let priorityBarsHtml = priorities.map((p) => {
        const count = stats.per_priority[p] || 0;
        const pct = total > 0 ? (count / total * 100) : 0;
        return `
            <div class="stat-bar-item">
                <div class="stat-bar-label">
                    <span style="text-transform:capitalize">${p}</span>
                    <span>${count}</span>
                </div>
                <div class="stat-bar">
                    <div class="stat-bar-fill priority-${p}" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }).join("");

    content.innerHTML = `
        <div class="stat-card">
            <h3>Total Cards</h3>
            <div class="stat-number">${stats.total}</div>
        </div>

        <div class="stat-card">
            <h3>Overdue</h3>
            <div class="stat-number ${stats.overdue > 0 ? 'danger' : ''}">${stats.overdue}</div>
        </div>

        <div class="stat-card">
            <h3>Cards per Column</h3>
            <div class="stat-bar-group">${columnBarsHtml}</div>
        </div>

        <div class="stat-card">
            <h3>By Priority</h3>
            <div class="stat-bar-group">${priorityBarsHtml}</div>
        </div>
    `;
}

// ── Theme Toggle ──────────────────────────────────────────────────────

const themeToggle = document.getElementById("themeToggle");

function initTheme() {
    const saved = localStorage.getItem("kanban-theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    updateThemeIcon(saved);
}

themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("kanban-theme", next);
    updateThemeIcon(next);
});

function updateThemeIcon(theme) {
    themeToggle.innerHTML = theme === "dark" ? "&#9789;" : "&#9728;";
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ── Init ──────────────────────────────────────────────────────────────
initTheme();
loadBoard();
