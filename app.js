const STORAGE_KEY = "daylight-todo-state";
const STARTED_KEY = "taskora-started";

const DEFAULT_CATEGORIES = [
    { id: "personal", name: "Personal", color: "#b69cff" },
    { id: "work", name: "Work", color: "#65c8e8" },
    { id: "study", name: "Study", color: "#f0bb68" },
    { id: "projects", name: "Projects", color: "#73d6a5" }
];

const TIMER_MODES = {
    focus: { label: "Focus", durationSeconds: 25 * 60 },
    shortBreak: { label: "Short break", durationSeconds: 5 * 60 },
    longBreak: { label: "Long break", durationSeconds: 15 * 60 }
};

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 99;

const welcomeScreen = document.querySelector("#welcome-screen");
const appShell = document.querySelector("#app-shell");
const taskForm = document.querySelector("#task-form");
const taskInput = document.querySelector("#task-input");
const taskCategory = document.querySelector("#task-category");
const taskFilter = document.querySelector("#task-filter");
const taskPriority = document.querySelector("#task-priority");
const taskDeadline = document.querySelector("#task-deadline");
const calendarGrid = document.querySelector("#calendar-grid");
const categoryDialog = document.querySelector("#category-dialog");
const taskEditDialog = document.querySelector("#task-edit-dialog");
const focusTaskSelect = document.querySelector("#focus-task-select");
const timerStartButton = document.querySelector("#timer-start");

let timerCompletionTimeout = null;
let timerAudioContext = null;
let openDropdown = null;
let activeDatePicker = null;
let activeCalendarMonth = null;

const customSelects = new WeakMap();
const datePickers = new WeakMap();

function createDefaultTimer() {
    return {
        mode: "focus",
        status: "idle",
        remainingSeconds: TIMER_MODES.focus.durationSeconds,
        endsAt: null,
        taskId: null,
        notice: ""
    };
}

function normalizeTimer(timer) {
    if (!timer || !TIMER_MODES[timer.mode]) {
        return createDefaultTimer();
    }

    return {
        ...createDefaultTimer(),
        ...timer,
        mode: timer.mode,
        status: ["running", "paused", "idle"].includes(timer.status)
            ? timer.status
            : "idle",
        remainingSeconds: Number.isFinite(timer.remainingSeconds)
            ? Math.max(0, timer.remainingSeconds)
            : TIMER_MODES[timer.mode].durationSeconds,
        endsAt: Number.isFinite(timer.endsAt) ? timer.endsAt : null,
        taskId: typeof timer.taskId === "string" ? timer.taskId : null,
        notice: typeof timer.notice === "string" ? timer.notice : ""
    };
}

function normalizeTask(task) {
    const status = task.completed || task.status === "completed"
        ? "completed"
        : ["todo", "in-progress"].includes(task.status)
            ? task.status
            : "todo";

    return {
        ...task,
        categoryId: task.categoryId || null,
        status,
        completed: status === "completed",
        priority: ["low", "medium", "high"].includes(task.priority)
            ? task.priority
            : "medium",
        deadline: typeof task.deadline === "string" ? task.deadline : ""
    };
}

function loadState() {
    try {
        const savedState = JSON.parse(
            localStorage.getItem(STORAGE_KEY) || "{}"
        );

        const tasks = Array.isArray(savedState.tasks)
            ? savedState.tasks
            : [];

        const focusHistory = Array.isArray(savedState.focusHistory)
            ? savedState.focusHistory.filter((session) =>
                session &&
                typeof session.id === "string" &&
                TIMER_MODES[session.mode] &&
                Number.isFinite(session.durationSeconds) &&
                typeof session.completedAt === "string"
            )
            : [];

        const focusSessions = focusHistory.filter(
            (session) => session.mode === "focus"
        );

        return {
            tasks: tasks.map(normalizeTask),

            activityDates: Array.isArray(savedState.activityDates)
                ? savedState.activityDates
                : [],

            profileName: typeof savedState.profileName === "string"
                ? savedState.profileName
                : "",

            focusTimer: normalizeTimer(savedState.focusTimer),

            focusHistory,

            focusSessionsCompleted: Number.isFinite(
                savedState.focusSessionsCompleted
            )
                ? savedState.focusSessionsCompleted
                : focusSessions.length,

            totalFocusSeconds: Number.isFinite(savedState.totalFocusSeconds)
                ? savedState.totalFocusSeconds
                : focusSessions.reduce(
                    (total, session) => total + session.durationSeconds,
                    0
                ),

            categories: Array.isArray(savedState.categories)
                ? savedState.categories.filter((category) =>
                    category &&
                    typeof category.id === "string" &&
                    typeof category.name === "string" &&
                    typeof category.color === "string"
                )
                : DEFAULT_CATEGORIES.map((category) => ({ ...category }))
        };

    } catch (error) {
        console.error(
            "Could not load saved tasks. Starting with an empty list.",
            error
        );

        return {
            tasks: [],
            activityDates: [],
            profileName: "",
            focusTimer: createDefaultTimer(),
            focusHistory: [],
            focusSessionsCompleted: 0,
            totalFocusSeconds: 0,
            categories: DEFAULT_CATEGORIES.map((category) => ({ ...category }))
        };
    }
}

const state = loadState();
state.focusTimer = normalizeTimer(state.focusTimer);

let calendarMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
);

let selectedCategoryId = null;

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error(
            "Could not save your changes in this browser.",
            error
        );
    }
}

function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function shiftDateKey(key, amount) {
    const [year, month, day] = key.split("-").map(Number);

    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + amount);

    return dateKey(date);
}

function dayNumber(key) {
    const [year, month, day] = key.split("-").map(Number);

    return Date.UTC(year, month - 1, day) / 86400000;
}

function getStreaks() {
    const dates = [...new Set(state.activityDates)].sort();

    if (dates.length === 0) {
        return { current: 0, best: 0 };
    }

    const today = dateKey(new Date());

    const latestActiveDay = dates.includes(today)
        ? today
        : shiftDateKey(today, -1);

    let current = 0;
    let activeDay = latestActiveDay;

    while (dates.includes(activeDay)) {
        current += 1;
        activeDay = shiftDateKey(activeDay, -1);
    }

    let best = 1;
    let run = 1;

    for (let index = 1; index < dates.length; index += 1) {
        if (
            dayNumber(dates[index]) -
            dayNumber(dates[index - 1]) === 1
        ) {
            run += 1;
            best = Math.max(best, run);
        } else {
            run = 1;
        }
    }

    return { current, best };
}

function formatTaskCount(count) {
    return `${count} ${count === 1 ? "task" : "tasks"}`;
}

function getCategory(categoryId) {
    return state.categories.find(
        (category) => category.id === categoryId
    );
}

function setTaskStatus(task, status) {
    task.status = status;
    task.completed = status === "completed";

    task.completedAt = task.completed
        ? task.completedAt || dateKey(new Date())
        : null;

    if (
        task.completed &&
        !state.activityDates.includes(task.completedAt)
    ) {
        state.activityDates.push(task.completedAt);
    }
}

function formatDeadline(deadline) {
    if (!deadline) {
        return "";
    }

    const [year, month, day] = deadline.split("-").map(Number);

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric"
    }).format(new Date(year, month - 1, day));
}

function getSelectOptionColor(select, option) {
    if (!option.value) {
        return "";
    }

    if (
        select.classList.contains("task-priority-input") ||
        select.id === "edit-task-priority"
    ) {
        return {
            low: "#73d6a5",
            medium: "#f0bb68",
            high: "#ff8294"
        }[option.value] || "";
    }

    const category = state.categories.find(
        (item) => item.id === option.value
    );

    if (category) {
        return category.color;
    }

    return "";
}

function positionDropdown(host, menu) {
    const rect = host.getBoundingClientRect();

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    const openAbove =
        spaceBelow < 220 && spaceAbove > spaceBelow;

    const maxHeight = Math.max(
        120,
        Math.min(280, openAbove ? spaceAbove - 12 : spaceBelow - 12)
    );

    const width = Math.min(
        Math.max(rect.width, 150),
        viewportWidth - 24
    );

    const left = Math.max(
        12,
        Math.min(rect.left, viewportWidth - width - 12)
    );

    menu.style.position = "fixed";
    menu.style.left = `${left}px`;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${maxHeight}px`;

    menu.classList.toggle("open-above", openAbove);

    if (openAbove) {
        menu.style.top = "auto";
        menu.style.bottom = `${viewportHeight - rect.top + 6}px`;
    } else {
        menu.style.bottom = "auto";
        menu.style.top = `${rect.bottom + 6}px`;
    }
}

function closeCustomSelect(returnFocus = false) {
    if (!openDropdown) {
        return;
    }

    const dropdown = openDropdown;

    openDropdown = null;

    dropdown.trigger.setAttribute("aria-expanded", "false");
    dropdown.host.classList.remove("is-open");
    dropdown.menu.classList.add("is-closing");

    window.clearTimeout(dropdown.closeTimeout);

    dropdown.closeTimeout = window.setTimeout(() => {
        dropdown.menu.hidden = true;
        dropdown.menu.classList.remove("is-closing");
    }, 130);

    if (returnFocus) {
        dropdown.trigger.focus();
    }
}

function refreshCustomSelect(select) {
    const customSelect = customSelects.get(select);

    if (!customSelect) {
        return;
    }

    const {
        host,
        trigger,
        menu,
        valueLabel,
        indicator
    } = customSelect;

    const selectedOption = select.selectedOptions[0];

    valueLabel.textContent = selectedOption
        ? selectedOption.textContent
        : "Select";

    const selectedColor = selectedOption
        ? getSelectOptionColor(select, selectedOption)
        : "";

    indicator.hidden = !selectedColor;

    if (selectedColor) {
        indicator.style.setProperty("--option-color", selectedColor);
    }

    host.style.setProperty("--option-color", selectedColor || "#9275ff");

    menu.replaceChildren();

    [...select.options].forEach((option) => {
        const optionButton = document.createElement("button");

        optionButton.type = "button";
        optionButton.className = "custom-select-option";
        optionButton.setAttribute("role", "option");

        optionButton.disabled = option.disabled;
        optionButton.setAttribute(
            "aria-selected",
            String(option.selected)
        );

        const color = getSelectOptionColor(select, option);

        if (color) {
            optionButton.style.setProperty("--option-color", color);
        }

        const dot = document.createElement("span");
        dot.className = "custom-select-option-dot";
        dot.hidden = !color;

        const label = document.createElement("span");
        label.className = "custom-select-option-label";
        label.textContent = option.textContent;

        const check = document.createElement("span");
        check.className = "custom-select-option-check";
        check.textContent = option.selected ? "✓" : "";

        optionButton.append(dot, label, check);

        optionButton.addEventListener("click", () => {
            select.value = option.value;

            select.dispatchEvent(
                new Event("change", { bubbles: true })
            );

            refreshCustomSelect(select);
            closeCustomSelect(true);
        });

        menu.append(optionButton);
    });

    trigger.disabled = select.disabled;
    host.classList.toggle("is-disabled", select.disabled);
}

function enhanceCustomSelect(select) {
    if (!(select instanceof HTMLSelectElement)) {
        return;
    }

    if (customSelects.has(select)) {
        refreshCustomSelect(select);
        return;
    }

    const host = document.createElement("div");

    host.className = "custom-select-host";

    if (select.id === "task-category") {
        host.classList.add(
            "custom-select-host--category",
            "custom-select-host--task-category"
        );
    } else if (select.id === "task-priority") {
        host.classList.add("custom-select-host--priority");
    } else if (select.id === "task-filter") {
        host.classList.add("custom-select-host--filter");
    }

    const associatedLabels = [
        ...document.querySelectorAll(`label[for="${select.id}"]`)
    ];

    const labelText = associatedLabels
        .map((label) => label.textContent.trim())
        .filter(Boolean)
        .join(" ") || "Select";

    const trigger = document.createElement("button");

    trigger.className = "custom-select-trigger";
    trigger.type = "button";
    trigger.id = `${select.id || `custom-select-${Math.random().toString(36).slice(2, 8)}`}-trigger`;

    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", labelText);

    const valueLabel = document.createElement("span");
    valueLabel.className = "custom-select-value";

    const indicator = document.createElement("span");
    indicator.className = "custom-select-indicator";
    indicator.setAttribute("aria-hidden", "true");

    const arrow = document.createElement("span");
    arrow.className = "custom-select-arrow";
    arrow.setAttribute("aria-hidden", "true");

    trigger.append(indicator, valueLabel, arrow);

    const menu = document.createElement("div");

    menu.className = "custom-select-menu";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    menu.id = `custom-options-${Math.random().toString(36).slice(2, 9)}`;

    trigger.setAttribute("aria-controls", menu.id);

    // Keep the original select inside its wrapper.
    // This avoids the previous DOM hierarchy error.
    const parent = select.parentNode;

    parent.insertBefore(host, select);
    host.append(trigger, menu, select);

    host.classList.add("is-enhanced");

    associatedLabels.forEach((label) => {
        label.htmlFor = trigger.id;
    });

    select.classList.add("native-control-hidden");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;

    const customSelect = {
        host,
        trigger,
        menu,
        valueLabel,
        indicator,
        labelText
    };

    customSelects.set(select, customSelect);

    refreshCustomSelect(select);

    trigger.addEventListener("click", () => {
        if (openDropdown?.host === host) {
            closeCustomSelect();
            return;
        }

        closeCustomSelect();
        closeDatePicker();

        window.clearTimeout(customSelect.closeTimeout);

        menu.classList.remove("is-closing");

        refreshCustomSelect(select);

        menu.hidden = false;

        host.classList.add("is-open");

        trigger.setAttribute("aria-expanded", "true");

        openDropdown = customSelect;

        positionDropdown(host, menu);

        const selectedIndex = [...select.options].findIndex(
            (option) => option.value === select.value
        );

        const options = [
            ...menu.querySelectorAll('[role="option"]:not(:disabled)')
        ];

        if (options.length) {
            options[Math.max(0, selectedIndex)].focus();
        }
    });

    trigger.addEventListener("keydown", (event) => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            trigger.click();
        }
    });

    menu.addEventListener("keydown", (event) => {
        const options = [
            ...menu.querySelectorAll('[role="option"]:not(:disabled)')
        ];

        const currentIndex = options.indexOf(document.activeElement);

        if (event.key === "Escape") {
            event.preventDefault();
            closeCustomSelect(true);
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            options[Math.min(currentIndex + 1, options.length - 1)]?.focus();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            options[Math.max(currentIndex - 1, 0)]?.focus();
        }
    });
}

function dateToKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
    if (!value) {
        return null;
    }

    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function formatSelectedDate(value) {
    const date = parseDateKey(value);

    return date
        ? new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric"
        }).format(date)
        : "Select a date";
}

function closeDatePicker() {
    if (!activeDatePicker) {
        return;
    }

    const picker = activeDatePicker;

    picker.button.setAttribute("aria-expanded", "false");
    picker.wrapper.classList.remove("is-open");
    picker.popup.classList.add("is-closing");

    window.clearTimeout(picker.closeTimeout);

    picker.closeTimeout = window.setTimeout(() => {
        picker.popup.hidden = true;
        picker.popup.classList.remove("is-closing");
    }, 130);

    activeDatePicker = null;
}

function refreshDatePicker(input) {
    const picker = datePickers.get(input);

    if (!picker) {
        return;
    }

    picker.valueLabel.textContent = formatSelectedDate(input.value);

    picker.valueLabel.classList.toggle(
        "is-placeholder",
        !input.value
    );

    picker.button.setAttribute(
        "aria-label",
        input.value
            ? `Due date: ${formatSelectedDate(input.value)}`
            : "Choose due date"
    );

    picker.button.classList.toggle(
        "has-value",
        Boolean(input.value)
    );

    picker.clearButton.disabled = !input.value;
}

function positionDatePicker(picker) {
    const rect = picker.button.getBoundingClientRect();

    const popupHeight = picker.popup.offsetHeight || 370;
    const popupWidth = Math.min(326, window.innerWidth - 24);

    const openAbove =
        window.innerHeight - rect.bottom < popupHeight + 10 &&
        rect.top > popupHeight;

    const left = Math.max(
        12,
        Math.min(rect.left, window.innerWidth - popupWidth - 12)
    );

    picker.popup.style.left = `${left}px`;
    picker.popup.style.width = `${popupWidth}px`;

    picker.popup.style.top = openAbove
        ? "auto"
        : `${rect.bottom + 9}px`;

    picker.popup.style.bottom = openAbove
        ? `${window.innerHeight - rect.top + 9}px`
        : "auto";
}

function changeCalendarMonth(picker, offset) {
    activeCalendarMonth = new Date(
        activeCalendarMonth.getFullYear(),
        activeCalendarMonth.getMonth() + offset,
        1
    );

    renderDateCalendar(picker);
}

function renderDateCalendar(picker) {
    const year = activeCalendarMonth.getFullYear();
    const month = activeCalendarMonth.getMonth();

    const today = new Date();
    const todayKey = dateToKey(today);

    picker.monthLabel.textContent = new Intl.DateTimeFormat(
        undefined,
        {
            month: "long",
            year: "numeric"
        }
    ).format(activeCalendarMonth);

    picker.grid.replaceChildren();

    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(
        (weekday) => {
            const heading = document.createElement("span");

            heading.className = "custom-calendar-weekday";
            heading.textContent = weekday;
            heading.setAttribute("role", "columnheader");

            picker.grid.append(heading);
        }
    );

    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();

    const monthLength = new Date(
        year,
        month + 1,
        0
    ).getDate();

    const previousMonthLength = new Date(
        year,
        month,
        0
    ).getDate();

    const cellCount =
        Math.ceil((startOffset + monthLength) / 7) * 7;

    for (let index = 0; index < cellCount; index += 1) {
        let date;
        let outsideMonth = false;

        if (index < startOffset) {
            date = new Date(
                year,
                month - 1,
                previousMonthLength - startOffset + index + 1
            );

            outsideMonth = true;

        } else if (index >= startOffset + monthLength) {
            date = new Date(
                year,
                month + 1,
                index - startOffset - monthLength + 1
            );

            outsideMonth = true;

        } else {
            date = new Date(
                year,
                month,
                index - startOffset + 1
            );
        }

        const key = dateToKey(date);

        const dayButton = document.createElement("button");

        dayButton.className = "custom-calendar-day";
        dayButton.type = "button";
        dayButton.tabIndex = -1;
        dayButton.dataset.date = key;
        dayButton.textContent = date.getDate();

        dayButton.setAttribute("role", "gridcell");

        dayButton.setAttribute(
            "aria-label",
            new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
            }).format(date)
        );

        if (outsideMonth) {
            dayButton.classList.add("is-outside-month");
        }

        if (key === todayKey) {
            dayButton.classList.add("is-today");
            dayButton.setAttribute("aria-current", "date");
        }

        if (key === picker.input.value) {
            dayButton.classList.add("is-selected");
            dayButton.setAttribute("aria-selected", "true");
        } else {
            dayButton.setAttribute("aria-selected", "false");
        }

        dayButton.addEventListener("click", () => {
            picker.input.value = key;

            picker.input.dispatchEvent(
                new Event("input", { bubbles: true })
            );

            picker.input.dispatchEvent(
                new Event("change", { bubbles: true })
            );

            refreshDatePicker(picker.input);
            closeDatePicker();

            picker.button.focus();
        });

        picker.grid.append(dayButton);
    }
}

function enhanceDatePicker(input) {
    if (
        !(input instanceof HTMLInputElement) ||
        input.type !== "date"
    ) {
        return;
    }

    if (!datePickers.has(input)) {
        const wrapper = document.createElement("div");

        wrapper.className =
            `custom-date-host ${
                input.id === "task-deadline"
                    ? "custom-date-host--task"
                    : "custom-date-host--edit"
            }`;

        const button = document.createElement("button");

        button.className = "custom-date-trigger";
        button.type = "button";
        button.id = `${input.id}-trigger`;

        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", "false");

        const icon = document.createElement("span");

        icon.className = "custom-date-icon";
        icon.setAttribute("aria-hidden", "true");

        const valueLabel = document.createElement("span");

        valueLabel.className = "custom-date-value";

        button.append(icon, valueLabel);

        const popup = document.createElement("div");

        popup.className = "custom-calendar-popup";
        popup.hidden = true;

        popup.setAttribute("role", "dialog");
        popup.setAttribute("aria-label", "Choose due date");

        const header = document.createElement("div");
        header.className = "custom-calendar-header";

        const monthLabel = document.createElement("h3");
        monthLabel.className = "custom-calendar-month";

        const monthActions = document.createElement("div");
        monthActions.className = "custom-calendar-month-actions";

        const previous = document.createElement("button");

        previous.type = "button";
        previous.className = "custom-calendar-nav";
        previous.setAttribute("aria-label", "Previous month");
        previous.textContent = "‹";

        const next = document.createElement("button");

        next.type = "button";
        next.className = "custom-calendar-nav";
        next.setAttribute("aria-label", "Next month");
        next.textContent = "›";

        monthActions.append(previous, next);
        header.append(monthLabel, monthActions);

        const grid = document.createElement("div");

        grid.className = "custom-calendar-grid";
        grid.setAttribute("role", "grid");

        const footer = document.createElement("div");
        footer.className = "custom-calendar-footer";

        const clearButton = document.createElement("button");

        clearButton.type = "button";
        clearButton.className = "custom-calendar-clear";
        clearButton.textContent = "Clear";

        const todayButton = document.createElement("button");

        todayButton.type = "button";
        todayButton.className = "custom-calendar-today";
        todayButton.textContent = "Today";

        footer.append(clearButton, todayButton);

        popup.append(header, grid, footer);

        const parent = input.parentNode;

        parent.insertBefore(wrapper, input);
        wrapper.append(button, input);

        document
            .querySelectorAll(`label[for="${input.id}"]`)
            .forEach((label) => {
                label.htmlFor = button.id;
            });

        input.classList.add("native-control-hidden");
        input.setAttribute("aria-hidden", "true");
        input.tabIndex = -1;

        (input.closest("dialog") || document.body).append(popup);

        const picker = {
            input,
            wrapper,
            button,
            valueLabel,
            popup,
            monthLabel,
            grid,
            clearButton
        };

        datePickers.set(input, picker);

        button.addEventListener("click", () => {
            if (activeDatePicker === picker) {
                closeDatePicker();
                return;
            }

            closeCustomSelect();
            closeDatePicker();

            window.clearTimeout(picker.closeTimeout);

            popup.classList.remove("is-closing");

            activeDatePicker = picker;

            activeCalendarMonth = input.value
                ? new Date(
                    parseDateKey(input.value).getFullYear(),
                    parseDateKey(input.value).getMonth(),
                    1
                )
                : new Date(
                    new Date().getFullYear(),
                    new Date().getMonth(),
                    1
                );

            renderDateCalendar(picker);

            popup.hidden = false;
            wrapper.classList.add("is-open");

            button.setAttribute("aria-expanded", "true");

            positionDatePicker(picker);

            (
                popup.querySelector(".is-selected") ||
                popup.querySelector(".is-today") ||
                popup.querySelector(
                    ".custom-calendar-day:not(.is-outside-month)"
                )
            )?.focus();
        });

        previous.addEventListener("click", () => {
            changeCalendarMonth(picker, -1);
        });

        next.addEventListener("click", () => {
            changeCalendarMonth(picker, 1);
        });

        todayButton.addEventListener("click", () => {
            input.value = dateToKey(new Date());

            input.dispatchEvent(
                new Event("input", { bubbles: true })
            );

            input.dispatchEvent(
                new Event("change", { bubbles: true })
            );

            refreshDatePicker(input);

            activeCalendarMonth = new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
            );

            renderDateCalendar(picker);
        });

        clearButton.addEventListener("click", () => {
            input.value = "";

            input.dispatchEvent(
                new Event("input", { bubbles: true })
            );

            input.dispatchEvent(
                new Event("change", { bubbles: true })
            );

            refreshDatePicker(input);
            renderDateCalendar(picker);
        });

        popup.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();

                closeDatePicker();
                button.focus();

            } else if (
                ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]
                    .includes(event.key)
            ) {
                const currentDay = document.activeElement.closest(
                    ".custom-calendar-day"
                );

                if (currentDay) {
                    event.preventDefault();

                    const targetDate = parseDateKey(
                        currentDay.dataset.date
                    );

                    const delta = {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -7,
                        ArrowDown: 7
                    }[event.key];

                    targetDate.setDate(
                        targetDate.getDate() + delta
                    );

                    const targetKey = dateToKey(targetDate);

                    if (!grid.querySelector(`[data-date="${targetKey}"]`)) {
                        activeCalendarMonth = new Date(
                            targetDate.getFullYear(),
                            targetDate.getMonth(),
                            1
                        );

                        renderDateCalendar(picker);
                    }

                    grid.querySelector(
                        `[data-date="${targetKey}"]`
                    )?.focus();
                }
            }
        });

        input.addEventListener("change", () => {
            refreshDatePicker(input);
        });

        input.addEventListener("input", () => {
            refreshDatePicker(input);
        });
    }

    refreshDatePicker(input);
}

function syncCustomControls(root = document) {
    root.querySelectorAll("select").forEach(enhanceCustomSelect);

    root.querySelectorAll('input[type="date"]').forEach(
        enhanceDatePicker
    );
}

function closeOpenControls(event) {
    if (event.key === "Escape") {
        closeCustomSelect(true);

        if (activeDatePicker) {
            const picker = activeDatePicker;

            closeDatePicker();
            picker.button.focus();
        }
    }

    if (event.type === "pointerdown") {
        if (
            openDropdown &&
            !openDropdown.host.contains(event.target) &&
            !openDropdown.menu.contains(event.target)
        ) {
            closeCustomSelect();
        }

        if (
            activeDatePicker &&
            !activeDatePicker.wrapper.contains(event.target) &&
            !activeDatePicker.popup.contains(event.target)
        ) {
            closeDatePicker();
        }
    }
}

function renderCategoryControls() {
    const selectedTaskCategory = taskCategory.value;
    const selectedFilter = taskFilter.value || "all";

    taskCategory.replaceChildren(
        new Option("No category", "")
    );

    taskFilter.replaceChildren(
        new Option("All categories", "all")
    );

    for (const category of state.categories) {
        const categoryCount = state.tasks.filter(
            (task) => task.categoryId === category.id
        ).length;

        const taskOption = new Option(
            category.name,
            category.id
        );

        const filterOption = new Option(
            `${category.name} (${categoryCount})`,
            category.id
        );

        taskCategory.append(taskOption);
        taskFilter.append(filterOption);
    }

    taskCategory.value = state.categories.some(
        (category) => category.id === selectedTaskCategory
    )
        ? selectedTaskCategory
        : "";

    taskFilter.value =
        selectedFilter === "all" ||
        state.categories.some(
            (category) => category.id === selectedFilter
        )
            ? selectedFilter
            : "all";

    updateTaskOptionStyles();

    refreshCustomSelect(taskCategory);
    refreshCustomSelect(taskFilter);

    const categoryList = document.querySelector(
        "#sidebar-categories"
    );

    categoryList.replaceChildren();

    for (const category of state.categories) {
        const count = state.tasks.filter(
            (task) => task.categoryId === category.id
        ).length;

        const row = document.createElement("li");
        row.className = "category-nav-item";

        const categoryButton = document.createElement("button");

        categoryButton.className = "category-nav-link";
        categoryButton.type = "button";

        categoryButton.classList.toggle(
            "is-selected",
            selectedCategoryId === category.id
        );

        categoryButton.setAttribute(
            "aria-label",
            `${category.name}, ${formatTaskCount(count)}`
        );

        categoryButton.addEventListener("click", () => {
            showCategory(category.id);
        });

        const colorDot = document.createElement("span");

        colorDot.className = "category-color-dot";

        colorDot.style.setProperty(
            "--category-color",
            category.color
        );

        const name = document.createElement("span");

        name.className = "category-nav-name";
        name.textContent = category.name;

        const countLabel = document.createElement("span");

        countLabel.className = "category-count";
        countLabel.textContent = count;

        categoryButton.append(colorDot, name, countLabel);

        const editButton = document.createElement("button");

        editButton.className = "category-edit-button";
        editButton.type = "button";
        editButton.textContent = "···";

        editButton.setAttribute(
            "aria-label",
            `Edit ${category.name} category`
        );

        editButton.addEventListener("click", () => {
            openCategoryDialog(category);
        });

        row.append(categoryButton, editButton);
        categoryList.append(row);
    }
}

function updateTaskOptionStyles() {
    const category = state.categories.find(
        (item) => item.id === taskCategory.value
    );

    taskCategory.classList.toggle(
        "has-value",
        Boolean(category)
    );

    taskCategory.style.setProperty(
        "--option-accent",
        category ? category.color : "#a99aff"
    );

    taskPriority.classList.remove(
        "priority-low",
        "priority-medium",
        "priority-high"
    );

    taskPriority.classList.add(
        `priority-${taskPriority.value}`
    );

    taskDeadline.classList.toggle(
        "has-value",
        Boolean(taskDeadline.value)
    );
}

function createTaskItem(task) {
    const item = document.createElement("li");
    item.className = "task-item";

    const checkbox = document.createElement("input");
    checkbox.className = "task-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.id = `task-${task.id}`;

    checkbox.setAttribute(
        "aria-label",
        `Mark "${task.text}" as ${task.completed ? "not done" : "done"}`
    );

    checkbox.addEventListener("change", () => {
        setTaskStatus(
            task,
            checkbox.checked ? "completed" : "todo"
        );

        saveState();
        renderApp();
    });

    const label = document.createElement("label");
    label.className = "task-text";
    label.htmlFor = checkbox.id;
    label.textContent = task.text;

    if (task.completed) {
        label.classList.add("is-complete");
    }

    const categorySelect = document.createElement("select");
    categorySelect.className = "task-category-select";

    categorySelect.setAttribute(
        "aria-label",
        `Change category for "${task.text}"`
    );

    categorySelect.append(new Option("No category", ""));

    for (const category of state.categories) {
        categorySelect.append(
            new Option(category.name, category.id)
        );
    }

    categorySelect.value = task.categoryId || "";

    const category = getCategory(task.categoryId);

    categorySelect.style.setProperty(
        "--category-color",
        category ? category.color : "#9896a7"
    );

    categorySelect.addEventListener("change", () => {
        task.categoryId = categorySelect.value || null;

        saveState();
        renderApp();
    });

    item.append(checkbox, label, categorySelect);

    const deleteButton = document.createElement("button");

    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";

    deleteButton.setAttribute(
        "aria-label",
        `Delete "${task.text}"`
    );

    deleteButton.addEventListener("click", () => {
        deleteTask(task.id);
    });

    item.append(deleteButton);

    return item;
}

function renderTaskList(listId, emptyId, tasks) {
    const list = document.querySelector(`#${listId}`);
    const emptyState = document.querySelector(`#${emptyId}`);

    if (!list || !emptyState) {
        return;
    }

    list.replaceChildren(...tasks.map(createTaskItem));

    emptyState.hidden = tasks.length > 0;

    syncCustomControls(list);
}

function deleteTask(taskId) {
    state.tasks = state.tasks.filter(
        (task) => task.id !== taskId
    );

    saveState();
    renderApp();
}

function openTaskEditor(task) {
    document.querySelector("#edit-task-id").value = task.id;
    document.querySelector("#edit-task-title").value = task.text;

    const categorySelect = document.querySelector(
        "#edit-task-category"
    );

    categorySelect.replaceChildren(
        new Option("No category", "")
    );

    for (const category of state.categories) {
        categorySelect.append(
            new Option(category.name, category.id)
        );
    }

    categorySelect.value = task.categoryId || "";

    document.querySelector("#edit-task-priority").value =
        task.priority;

    document.querySelector("#edit-task-deadline").value =
        task.deadline;

    syncCustomControls(taskEditDialog);

    taskEditDialog.showModal();

    document.querySelector("#edit-task-title").focus();
}

function createKanbanCard(task) {
    const card = document.createElement("article");

    card.className = "kanban-task";
    card.draggable = true;
    card.dataset.taskId = task.id;

    card.setAttribute(
        "aria-label",
        `${task.text}, ${task.status.replace("-", " ")}, ${task.priority} priority`
    );

    card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "move";

        card.classList.add("is-dragging");
    });

    card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");

        document.querySelectorAll(".kanban-dropzone")
            .forEach((zone) => {
                zone.classList.remove("is-drag-over");
            });
    });

    const cardTop = document.createElement("div");
    cardTop.className = "kanban-card-top";

    const category = getCategory(task.categoryId);

    const categoryBadge = document.createElement("span");

    categoryBadge.className = category
        ? "kanban-category"
        : "kanban-category is-uncategorized";

    if (category) {
        categoryBadge.style.setProperty(
            "--category-color",
            category.color
        );

        categoryBadge.textContent = category.name;
    } else {
        categoryBadge.textContent = "Uncategorized";
    }

    cardTop.append(categoryBadge);

    const priority = document.createElement("span");

    priority.className = `priority-badge priority-${task.priority}`;
    priority.textContent = `${task.priority} priority`;

    cardTop.append(priority);

    const title = document.createElement("h3");

    title.className = "kanban-task-title";
    title.textContent = task.text;

    const cardFooter = document.createElement("div");
    cardFooter.className = "kanban-card-footer";

    const deadline = document.createElement("span");
    deadline.className = "kanban-deadline";

    if (task.deadline) {
        deadline.textContent = `Due ${formatDeadline(task.deadline)}`;

        if (
            task.status !== "completed" &&
            task.deadline < dateKey(new Date())
        ) {
            deadline.classList.add("is-overdue");
        }
    } else {
        deadline.textContent = "No deadline";
        deadline.classList.add("no-deadline");
    }

    const actions = document.createElement("div");
    actions.className = "kanban-card-actions";

    const editButton = document.createElement("button");

    editButton.className = "kanban-action";
    editButton.type = "button";
    editButton.textContent = "Edit";

    editButton.addEventListener("click", () => {
        openTaskEditor(task);
    });

    const deleteButton = document.createElement("button");

    deleteButton.className = "kanban-action kanban-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", () => {
        deleteTask(task.id);
    });

    actions.append(editButton, deleteButton);

    cardFooter.append(deadline, actions);

    card.append(cardTop, title, cardFooter);

    return card;
}

function renderKanbanBoard() {
    const columns = [
        {
            status: "todo",
            id: "todo-column",
            countId: "todo-count"
        },
        {
            status: "in-progress",
            id: "in-progress-column",
            countId: "in-progress-count"
        },
        {
            status: "completed",
            id: "completed-column",
            countId: "kanban-completed-count"
        }
    ];

    for (const column of columns) {
        const zone = document.querySelector(`#${column.id}`);

        if (!zone) {
            continue;
        }

        const tasks = state.tasks.filter(
            (task) => task.status === column.status
        );

        zone.replaceChildren();

        document.querySelector(`#${column.countId}`).textContent =
            tasks.length;

        if (tasks.length === 0) {
            const empty = document.createElement("p");

            empty.className = "kanban-column-empty";
            empty.textContent = "Drop a task here";

            zone.append(empty);
        } else {
            tasks.forEach((task) => {
                zone.append(createKanbanCard(task));
            });
        }
    }
}

function bindKanbanDropzones() {
    document.querySelectorAll(".kanban-dropzone")
        .forEach((zone) => {
            zone.addEventListener("dragover", (event) => {
                event.preventDefault();

                event.dataTransfer.dropEffect = "move";

                zone.classList.add("is-drag-over");
            });

            zone.addEventListener("dragenter", (event) => {
                event.preventDefault();

                zone.classList.add("is-drag-over");
            });

            zone.addEventListener("dragleave", (event) => {
                if (!zone.contains(event.relatedTarget)) {
                    zone.classList.remove("is-drag-over");
                }
            });

            zone.addEventListener("drop", (event) => {
                event.preventDefault();

                zone.classList.remove("is-drag-over");

                const taskId = event.dataTransfer.getData("text/plain");

                const task = state.tasks.find(
                    (item) => item.id === taskId
                );

                if (!task || task.status === zone.dataset.status) {
                    return;
                }

                setTaskStatus(task, zone.dataset.status);

                saveState();
                renderApp();
            });
        });
}

function renderTasks() {
    const completedTasks = state.tasks.filter(
        (task) => task.completed
    );

    const pendingTasks = state.tasks.filter(
        (task) => !task.completed
    );

    const totalTasks = state.tasks.length;

    const progress = totalTasks === 0
        ? 0
        : Math.round(
            (completedTasks.length / totalTasks) * 100
        );

    const filteredTasks = state.tasks.filter((task) => {
    // Completed tasks ko Home page par mat dikhao
    if (task.completed) {
        return false;
    }

    // Category filter maintain rakho
    if (
        taskFilter.value &&
        taskFilter.value !== "all" &&
        task.categoryId !== taskFilter.value
    ) {
        return false;
      }

      return true;
    });

    renderTaskList(
        "home-task-list",
        "home-empty",
        filteredTasks
    );

    renderTaskList(
        "pending-task-list",
        "pending-empty",
        pendingTasks
    );

    renderTaskList(
        "completed-task-list",
        "completed-empty",
        completedTasks
    );

    const selectedCategoryTasks = selectedCategoryId
        ? state.tasks.filter(
            (task) => task.categoryId === selectedCategoryId
        )
        : [];

    renderTaskList(
        "category-task-list",
        "category-empty",
        selectedCategoryTasks
    );

    document.querySelector("#task-total").textContent =
        formatTaskCount(filteredTasks.length);

    document.querySelector("#pending-total").textContent =
        formatTaskCount(pendingTasks.length);

    document.querySelector("#completed-total").textContent =
        formatTaskCount(completedTasks.length);

    document.querySelector("#category-total").textContent =
        formatTaskCount(selectedCategoryTasks.length);

    document.querySelector("#pending-badge").textContent =
        pendingTasks.length;

    document.querySelector("#completed-count").textContent =
        completedTasks.length;

    document.querySelector("#remaining-count").textContent =
        pendingTasks.length;

    document.querySelector("#progress-percent").textContent =
        progress;

    document.querySelector("#ring-percent").textContent =
        `${progress}%`;

    document.querySelector("#progress-ring").setAttribute(
        "aria-label",
        `${progress}% of tasks completed`
    );

    document.querySelector("#progress-fill").style.width =
        `${progress}%`;

    document.querySelector("#progress-track").setAttribute(
        "aria-valuenow",
        progress
    );

    document.querySelector("#progress-summary").textContent =
        totalTasks === 0
            ? "Add a task to get your day moving."
            : `${completedTasks.length} of ${totalTasks} ${
                totalTasks === 1 ? "task" : "tasks"
            } completed.`;

    document.querySelector("#progress-message").textContent =
        progress === 100 && totalTasks > 0
            ? "All done — amazing work!"
            : progress > 0
                ? "You're making progress"
                : "A fresh start";

    document.querySelector("#profile-completed-count").textContent =
        completedTasks.length;
}

function renderCategories() {
    renderCategoryControls();

    const category = getCategory(selectedCategoryId);

    if (category) {
        document.querySelector("#category-view-title").textContent =
            category.name;

        document.querySelector("#category-view-subtitle").textContent =
            `${category.name} · ${formatTaskCount(
                state.tasks.filter(
                    (task) => task.categoryId === category.id
                ).length
            )}`;

        document.querySelector("#category-view-title").style.setProperty(
            "--category-color",
            category.color
        );
    }
}

function getTimerRemainingSeconds() {
    if (
        state.focusTimer.status === "running" &&
        state.focusTimer.endsAt
    ) {
        return Math.max(
            0,
            Math.ceil(
                (state.focusTimer.endsAt - Date.now()) / 1000
            )
        );
    }

    return Math.max(
        0,
        Math.ceil(state.focusTimer.remainingSeconds)
    );
}

function formatTimerTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(
        remainingSeconds
    ).padStart(2, "0")}`;
}

function formatFocusDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours ? `${hours}h ` : ""}${remainingMinutes}m`;
}

function renderFocusTimer() {
    const timer = state.focusTimer;
    const mode = TIMER_MODES[timer.mode];
    const remainingSeconds = getTimerRemainingSeconds();

    const selectedTaskId = timer.status === "idle"
        ? focusTaskSelect.value || timer.taskId
        : timer.taskId;

    const progress = Math.min(
        1,
        Math.max(
            0,
            1 - remainingSeconds / mode.durationSeconds
        )
    );

    const timerCircle = document.querySelector("#timer-circle");

    const statusText = timer.status === "running"
        ? `${mode.label} session in progress`
        : timer.status === "paused"
            ? "Session paused"
            : timer.notice || "Ready when you are";

    document.querySelector("#timer-time").textContent =
        formatTimerTime(remainingSeconds);

    document.querySelector("#timer-status").textContent =
        statusText;

    timerCircle.setAttribute(
        "aria-label",
        `${formatTimerTime(remainingSeconds)} remaining in ${mode.label}`
    );

    document.querySelector("#timer-ring-progress").style.strokeDashoffset =
        String(TIMER_CIRCUMFERENCE * (1 - progress));

    focusTaskSelect.replaceChildren(
        new Option("Choose a task", "")
    );

    for (const task of state.tasks) {
        const option = new Option(task.text, task.id);

        if (task.completed) {
            option.textContent = `${task.text} (completed)`;
        }

        focusTaskSelect.append(option);
    }

    focusTaskSelect.value = state.tasks.some(
        (task) => task.id === selectedTaskId
    )
        ? selectedTaskId
        : "";

    focusTaskSelect.disabled = timer.status !== "idle";

    document.querySelectorAll("[data-timer-mode]")
        .forEach((button) => {
            const isSelected =
                button.dataset.timerMode === timer.mode;

            button.classList.toggle("is-active", isSelected);

            button.setAttribute(
                "aria-pressed",
                String(isSelected)
            );

            button.disabled = timer.status !== "idle";
        });

    if (timer.status === "running") {
        timerStartButton.innerHTML =
            '<span aria-hidden="true">Ⅱ</span> Pause';

        timerStartButton.classList.add("is-running");

    } else if (timer.status === "paused") {
        timerStartButton.innerHTML =
            '<span aria-hidden="true">▶</span> Resume';

        timerStartButton.classList.remove("is-running");

    } else {
        timerStartButton.innerHTML =
            `<span aria-hidden="true">▶</span> Start ${mode.label.toLowerCase()}`;

        timerStartButton.classList.remove("is-running");
    }

    const totalMinutes = Math.floor(
        state.totalFocusSeconds / 60
    );

    document.querySelector("#focus-session-count").textContent =
        state.focusSessionsCompleted;

    document.querySelector("#focus-total-hours").textContent =
        Math.floor(totalMinutes / 60);

    document.querySelector("#focus-total-minutes").textContent =
        totalMinutes % 60;

    document.querySelector("#focus-history-count").textContent =
        formatTaskCount(state.focusHistory.length)
            .replace("task", "session");

    renderFocusHistory();

    refreshCustomSelect(focusTaskSelect);
}

function renderFocusHistory() {
    const historyList = document.querySelector("#focus-history-list");
    const emptyState = document.querySelector("#focus-history-empty");

    historyList.replaceChildren();

    for (const session of state.focusHistory.slice(0, 6)) {
        const item = document.createElement("li");

        item.className = "focus-history-item";

        const icon = document.createElement("span");

        icon.className =
            `history-mode-icon ${
                session.mode === "focus"
                    ? "history-focus-icon"
                    : "history-break-icon"
            }`;

        icon.textContent =
            session.mode === "focus" ? "✦" : "☕";

        icon.setAttribute("aria-hidden", "true");

        const details = document.createElement("span");

        details.className = "focus-history-details";

        const title = document.createElement("strong");

        title.textContent =
            session.taskTitle || TIMER_MODES[session.mode].label;

        const meta = document.createElement("small");

        const completedAt = new Date(session.completedAt);

        const dateLabel = new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric"
        }).format(completedAt);

        meta.textContent =
            `${TIMER_MODES[session.mode].label} · ${dateLabel}`;

        details.append(title, meta);

        const duration = document.createElement("span");

        duration.className = "history-duration";

        duration.textContent =
            formatFocusDuration(session.durationSeconds);

        item.append(icon, details, duration);

        historyList.append(item);
    }

    emptyState.hidden = state.focusHistory.length > 0;
}

function requestTimerNotifications() {
    if (!("Notification" in window)) {
        document.querySelector("#notification-note").textContent =
            "Browser notifications are not available here; the timer sound will still play.";

        return;
    }

    if (Notification.permission === "granted") {
        document.querySelector("#notification-note").textContent =
            "Notifications are enabled for session reminders.";

        return;
    }

    if (Notification.permission === "denied") {
        document.querySelector("#notification-note").textContent =
            "Notifications are blocked in browser settings; the timer sound will still play.";

        return;
    }

    Notification.requestPermission()
        .then((permission) => {
            document.querySelector("#notification-note").textContent =
                permission === "granted"
                    ? "Notifications are enabled for session reminders."
                    : "Allow notifications in browser settings to get session reminders.";
        })
        .catch((error) => {
            console.error(
                "Could not request notification permission.",
                error
            );
        });
}

function prepareTimerAudio() {
    try {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            return;
        }

        if (
            !timerAudioContext ||
            timerAudioContext.state === "closed"
        ) {
            timerAudioContext = new AudioContextClass();
        }

        if (timerAudioContext.state === "suspended") {
            timerAudioContext.resume().catch((error) => {
                console.error(
                    "Could not resume audio for the timer.",
                    error
                );
            });
        }

    } catch (error) {
        console.error(
            "Could not prepare audio for the timer.",
            error
        );
    }
}

function playTimerSound() {
    try {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            document.querySelector("#timer-message").textContent =
                "The session ended. This browser does not support sound playback.";

            return;
        }

        prepareTimerAudio();

        const playSequence = () => {
            const now = timerAudioContext.currentTime;

            [660, 880, 660].forEach((frequency, index) => {
                const oscillator =
                    timerAudioContext.createOscillator();

                const gain = timerAudioContext.createGain();

                const startAt = now + index * 0.22;

                oscillator.frequency.value = frequency;
                oscillator.type = "sine";

                gain.gain.setValueAtTime(0.0001, startAt);

                gain.gain.exponentialRampToValueAtTime(
                    0.16,
                    startAt + 0.025
                );

                gain.gain.exponentialRampToValueAtTime(
                    0.0001,
                    startAt + 0.18
                );

                oscillator.connect(gain);
                gain.connect(timerAudioContext.destination);

                oscillator.start(startAt);
                oscillator.stop(startAt + 0.19);
            });
        };

        if (timerAudioContext.state === "suspended") {
            timerAudioContext.resume()
                .then(playSequence)
                .catch((error) => {
                    console.error(
                        "Could not play the timer completion sound.",
                        error
                    );

                    document.querySelector("#timer-message").textContent =
                        "The session ended, but the sound could not be played by this browser.";
                });

        } else {
            playSequence();
        }

    } catch (error) {
        console.error(
            "Could not play the timer completion sound.",
            error
        );

        document.querySelector("#timer-message").textContent =
            "The session ended, but the sound could not be played by this browser.";
    }
}

function notifyTimerComplete(mode) {
    if (
        !("Notification" in window) ||
        Notification.permission !== "granted"
    ) {
        return;
    }

    try {
        new Notification(
            `${TIMER_MODES[mode].label} complete`,
            {
                body: mode === "focus"
                    ? "Great work. Take a well-earned break."
                    : "Break's over. Ready when you are?"
            }
        );

    } catch (error) {
        console.error(
            "Could not display the timer notification.",
            error
        );
    }
}

function completeTimerSession() {
    clearTimerCompletion();

    const timer = state.focusTimer;
    const mode = timer.mode;

    const task = state.tasks.find(
        (item) => item.id === timer.taskId
    );

    const completedAt = new Date().toISOString();

    state.focusHistory.unshift({
        id: `focus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        mode,
        durationSeconds: TIMER_MODES[mode].durationSeconds,
        taskId: task ? task.id : null,
        taskTitle: task ? task.text : "",
        completedAt
    });

    state.focusHistory = state.focusHistory.slice(0, 50);

    if (mode === "focus") {
        state.focusSessionsCompleted += 1;

        state.totalFocusSeconds +=
            TIMER_MODES.focus.durationSeconds;
    }

    timer.status = "idle";
    timer.remainingSeconds = TIMER_MODES[mode].durationSeconds;
    timer.endsAt = null;
    timer.notice = `${TIMER_MODES[mode].label} complete`;
    timer.taskId = null;

    document.querySelector("#timer-message").textContent =
        mode === "focus"
            ? "Focus session complete. Take a short break before your next one."
            : "Break complete. You’re ready for another session.";

    saveState();
    renderApp();

    playTimerSound();
    notifyTimerComplete(mode);
}

function updateTimer() {
    if (state.focusTimer.status !== "running") {
        return;
    }

    if (getTimerRemainingSeconds() === 0) {
        completeTimerSession();
        return;
    }

    renderFocusTimer();
}

function clearTimerCompletion() {
    if (timerCompletionTimeout !== null) {
        window.clearTimeout(timerCompletionTimeout);
        timerCompletionTimeout = null;
    }
}

function scheduleTimerCompletion() {
    clearTimerCompletion();

    if (state.focusTimer.status === "running") {
        const delay = Math.max(
            0,
            state.focusTimer.endsAt - Date.now()
        );

        timerCompletionTimeout = window.setTimeout(
            updateTimer,
            delay
        );
    }
}

function startTimer() {
    const timer = state.focusTimer;

    if (timer.status === "running") {
        timer.remainingSeconds = getTimerRemainingSeconds();
        timer.status = "paused";
        timer.endsAt = null;
        timer.notice = "";

    } else if (timer.status === "paused") {
        timer.status = "running";

        timer.endsAt =
            Date.now() + timer.remainingSeconds * 1000;

        timer.notice = "";

        prepareTimerAudio();

    } else {
        const selectedTask = state.tasks.find(
            (task) => task.id === focusTaskSelect.value
        );

        if (timer.mode === "focus" && !selectedTask) {
            document.querySelector("#timer-message").textContent =
                "Choose a task before starting a focus session.";

            focusTaskSelect.focus();

            return;
        }

        timer.remainingSeconds =
            TIMER_MODES[timer.mode].durationSeconds;

        timer.taskId = selectedTask ? selectedTask.id : null;

        timer.endsAt =
            Date.now() + timer.remainingSeconds * 1000;

        timer.status = "running";
        timer.notice = "";

        document.querySelector("#timer-message").textContent = "";

        prepareTimerAudio();
        requestTimerNotifications();
    }

    scheduleTimerCompletion();

    saveState();
    renderFocusTimer();
}

function resetTimer() {
    const timer = state.focusTimer;

    timer.status = "idle";
    timer.remainingSeconds = TIMER_MODES[timer.mode].durationSeconds;
    timer.endsAt = null;
    timer.notice = "";

    clearTimerCompletion();

    document.querySelector("#timer-message").textContent = "";

    saveState();
    renderFocusTimer();
}

function openCategoryDialog(category = null) {
    const categoryForm = document.querySelector("#category-form");

    categoryForm.reset();

    document.querySelector("#category-dialog-title").textContent =
        category ? "Edit category" : "New category";

    document.querySelector("#category-id").value =
        category ? category.id : "";

    document.querySelector("#category-name").value =
        category ? category.name : "";

    document.querySelector("#category-color").value =
        category ? category.color : "#a99aff";

    document.querySelector("#delete-category").hidden = !category;

    document.querySelector("#category-form-error").hidden = true;

    categoryDialog.showModal();

    document.querySelector("#category-name").focus();
}

function showCategory(categoryId) {
    const category = getCategory(categoryId);

    if (!category) return;

    selectedCategoryId = categoryId;

    // Save selected category
    sessionStorage.setItem("taskora-last-category", categoryId);

    renderCategories();
    renderTasks();

    showView("category");

    renderCategoryControls();
}

function renderProfile() {
    const displayName = state.profileName || "Your profile";

    const initial = state.profileName
        ? state.profileName.charAt(0).toUpperCase()
        : "Y";

    document.querySelector("#sidebar-name").textContent =
        displayName;

    document.querySelector("#profile-display-name").textContent =
        displayName;

    document.querySelector("#sidebar-avatar").textContent =
        initial;

    document.querySelector("#topbar-avatar").textContent =
        initial;

    document.querySelector("#profile-avatar").textContent =
        initial;

    document.querySelector("#profile-name").value =
        state.profileName;

    const today = new Date();

    const dateText = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(today);

    document.querySelector("#profile-current-date").textContent =
        `Today is ${dateText}`;

    document.querySelector("#topbar-date").textContent =
        dateText;

    document.querySelector("#home-greeting").textContent =
        state.profileName
            ? `YOUR DAY, ${state.profileName.toUpperCase()}`
            : "YOUR DAY, YOUR PACE";

    const streaks = getStreaks();

    document.querySelector("#current-streak").textContent =
        streaks.current;

    document.querySelector("#best-streak").textContent =
        streaks.best;
}

// CALENDAR

function renderCalendar() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const today = dateKey(new Date());

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const monthLabel = new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric"
    }).format(calendarMonth);

    document.querySelector("#calendar-month-label").textContent = monthLabel;
    calendarGrid.replaceChildren();

    const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    weekdayLabels.forEach((weekday) => {
        const label = document.createElement("span");
        label.className = "calendar-weekday";
        label.setAttribute("role", "columnheader");
        label.textContent = weekday;
        calendarGrid.append(label);
    });

    for (let blank = 0; blank < firstWeekday; blank++) {
        const spacer = document.createElement("span");
        spacer.className = "calendar-day calendar-day-empty";
        spacer.setAttribute("aria-hidden", "true");
        calendarGrid.append(spacer);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const key = dateKey(new Date(year, month, day));

        const dayButton = document.createElement("span");
        dayButton.className = "calendar-day";
        dayButton.setAttribute("role", "gridcell");
        dayButton.textContent = day;

        dayButton.setAttribute(
            "aria-label",
            new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
            }).format(new Date(year, month, day))
        );

        if (key === today) {
            dayButton.classList.add("is-today");
            dayButton.setAttribute("aria-current", "date");
        }

        if (state.activityDates.includes(key)) {
            dayButton.classList.add("has-activity");
            dayButton.setAttribute(
                "aria-label",
                `${dayButton.getAttribute("aria-label")}, task completed`
            );
        }

        calendarGrid.append(dayButton);
    }

    const currentMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
    );

    document.querySelector("#next-month").disabled =
        calendarMonth >= currentMonth;
}

// MAIN APP RENDERING

function renderApp() {
    renderCategories();
    renderTasks();
    renderKanbanBoard();
    renderFocusTimer();
    renderProfile();
    renderCalendar();
    syncCustomControls();
}

// NAVIGATION

function showView(viewName) {
    document.querySelectorAll(".page-view").forEach((view) => {
        view.hidden = view.dataset.view !== viewName;
    });

    document.querySelectorAll("[data-view-link]").forEach((link) => {
        const isActive = link.dataset.viewLink === viewName;

        link.classList.toggle("is-active", isActive);

        if (isActive) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });

    sessionStorage.setItem("taskora-last-view", viewName);

    if (viewName !== "category") {
    sessionStorage.removeItem("taskora-last-category");
    }

    if (viewName === "profile") {
        renderCalendar();
    }
}

document.querySelector("#get-started").addEventListener("click", () => {
    sessionStorage.setItem(STARTED_KEY, "true");
    sessionStorage.setItem("taskora-last-view", "home");

    document.documentElement.classList.add("has-started");

    welcomeScreen.hidden = true;
    appShell.hidden = false;

    showView("home");
});
// ==========================================
// NAVIGATION LINKS
// ==========================================

document.querySelectorAll("[data-view-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();

        selectedCategoryId = null;
        renderCategoryControls();

        showView(link.dataset.viewLink);
    });
});


// ==========================================
// DIALOG BUTTONS
// ==========================================

document.querySelector("#add-category").addEventListener("click", () => {
    openCategoryDialog();
});

document.querySelector("#manage-categories").addEventListener("click", () => {
    openCategoryDialog();
});

document.querySelector("#close-category-dialog").addEventListener("click", () => {
    categoryDialog.close();
});

document.querySelector("#cancel-category").addEventListener("click", () => {
    categoryDialog.close();
});

document.querySelector("#close-task-dialog").addEventListener("click", () => {
    taskEditDialog.close();
});

document.querySelector("#cancel-task-edit").addEventListener("click", () => {
    taskEditDialog.close();
});


// ==========================================
// FOCUS TIMER EVENTS
// ==========================================

timerStartButton.addEventListener("click", startTimer);

document.querySelector("#timer-reset").addEventListener("click", resetTimer);

document.querySelectorAll("[data-timer-mode]").forEach((button) => {
    button.addEventListener("click", () => {
        const mode = button.dataset.timerMode;

        if (
            state.focusTimer.status !== "idle" ||
            !TIMER_MODES[mode]
        ) {
            return;
        }

        state.focusTimer = {
            ...createDefaultTimer(),
            mode,
            taskId: focusTaskSelect.value || null,
            remainingSeconds: TIMER_MODES[mode].durationSeconds
        };

        document.querySelector("#timer-message").textContent = "";

        saveState();
        renderFocusTimer();
    });
});

focusTaskSelect.addEventListener("change", () => {
    if (state.focusTimer.status !== "idle") {
        return;
    }

    state.focusTimer.taskId = focusTaskSelect.value || null;

    saveState();
});


// ==========================================
// CATEGORY FORM
// ==========================================

document.querySelector("#category-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const categoryId = document.querySelector("#category-id").value;
    const name = document.querySelector("#category-name").value.trim();
    const color = document.querySelector("#category-color").value;

    const duplicate = state.categories.some((category) =>
        category.id !== categoryId &&
        category.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );

    if (!name || duplicate) {
        const error = document.querySelector("#category-form-error");

        error.textContent = duplicate
            ? "A category with this name already exists."
            : "Enter a category name.";

        error.hidden = false;

        document.querySelector("#category-name").focus();
        return;
    }

    if (categoryId) {
        const category = getCategory(categoryId);

        if (category) {
            category.name = name;
            category.color = color;
        }
    } else {
        state.categories.push({
            id: `category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            color
        });
    }

    saveState();

    categoryDialog.close();
    renderApp();
});


// ==========================================
// DELETE CATEGORY
// ==========================================

document.querySelector("#delete-category").addEventListener("click", () => {
    const categoryId = document.querySelector("#category-id").value;
    const category = getCategory(categoryId);

    if (!category) return;

    const isConfirmed = window.confirm(
        `Delete "${category.name}"? Tasks in this category will become uncategorized.`
    );

    if (!isConfirmed) return;

    state.tasks.forEach((task) => {
        if (task.categoryId === categoryId) {
            task.categoryId = null;
        }
    });

    state.categories = state.categories.filter(
        (item) => item.id !== categoryId
    );

    if (selectedCategoryId === categoryId) {
        selectedCategoryId = null;
        showView("home");
    }

    saveState();

    categoryDialog.close();
    renderApp();
});


// ==========================================
// TASK FILTERS
// ==========================================

taskFilter.addEventListener("change", renderTasks);

taskCategory.addEventListener("change", updateTaskOptionStyles);
taskPriority.addEventListener("change", updateTaskOptionStyles);

taskDeadline.addEventListener("input", updateTaskOptionStyles);
taskDeadline.addEventListener("change", updateTaskOptionStyles);


// ==========================================
// EDIT TASK FORM
// ==========================================

document.querySelector("#task-edit-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const taskId = document.querySelector("#edit-task-id").value;

    const task = state.tasks.find((item) => item.id === taskId);

    if (!task) {
        taskEditDialog.close();
        return;
    }

    const title = document.querySelector("#edit-task-title").value.trim();

    if (!title) {
        document.querySelector("#edit-task-title").focus();
        return;
    }

    task.text = title;

    task.categoryId =
        document.querySelector("#edit-task-category").value || null;

    task.priority =
        document.querySelector("#edit-task-priority").value;

    task.deadline =
        document.querySelector("#edit-task-deadline").value;

    saveState();

    taskEditDialog.close();
    renderApp();
});

// ==========================================
// DYNAMIC MOTIVATIONAL QUOTES
// ==========================================

function updateDailyQuote() {
    const quotes = [
        {
            text: "Small steps every day lead to big results.",
            author: "A little reminder"
        },
        {
            text: "Progress, not perfection.",
            author: "A little reminder"
        },
        {
            text: "Your only limit is your mindset.",
            author: "A little reminder"
        },
        {
            text: "Great things take time. Keep going.",
            author: "A little reminder"
        },
        {
            text: "Focus on what you can control today.",
            author: "A little reminder"
        },
        {
            text: "One task at a time. One day at a time.",
            author: "A little reminder"
        },
        {
            text: "Consistency turns effort into achievement.",
            author: "A little reminder"
        },
        {
            text: "Start where you are. Use what you have.",
            author: "A little reminder"
        },
        {
            text: "Make today count.",
            author: "A little reminder"
        },
        {
            text: "Little progress is still progress.",
            author: "A little reminder"
        }
    ];

    const quoteText = document.querySelector(".sidebar-tip p");
    const quoteAuthor = document.querySelector(".tip-caption");

    if (!quoteText || !quoteAuthor) return;

    const previousIndex = Number(
        sessionStorage.getItem("taskora-quote-index")
    );

    let randomIndex;

    do {
        randomIndex = Math.floor(Math.random() * quotes.length);
    } while (
        quotes.length > 1 &&
        randomIndex === previousIndex
    );

    const selectedQuote = quotes[randomIndex];

    quoteText.textContent = selectedQuote.text;
    quoteAuthor.textContent = `— ${selectedQuote.author}`;

    sessionStorage.setItem(
        "taskora-quote-index",
        String(randomIndex)
    );
}

// ==========================================
// ADD NEW TASK
// ==========================================

taskForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = taskInput.value.trim();

    if (!text) {
        taskInput.focus();
        return;
    }

    state.tasks.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        completed: false,
        status: "todo",
        completedAt: null,
        categoryId: taskCategory.value || null,
        priority: taskPriority.value,
        deadline: taskDeadline.value
    });

    saveState();

    taskInput.value = "";
    taskDeadline.value = "";

    renderApp();

    taskInput.focus();
});


// ==========================================
// PROFILE FORM
// ==========================================

document.querySelector("#name-form").addEventListener("submit", (event) => {
    event.preventDefault();

    state.profileName = document
        .querySelector("#profile-name")
        .value
        .trim()
        .slice(0, 40);

    saveState();
    renderProfile();
});


// ==========================================
// CALENDAR NAVIGATION
// ==========================================

document.querySelector("#previous-month").addEventListener("click", () => {
    calendarMonth = new Date(
        calendarMonth.getFullYear(),
        calendarMonth.getMonth() - 1,
        1
    );

    renderCalendar();
});

document.querySelector("#next-month").addEventListener("click", () => {
    const currentMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
    );

    if (calendarMonth < currentMonth) {
        calendarMonth = new Date(
            calendarMonth.getFullYear(),
            calendarMonth.getMonth() + 1,
            1
        );

        renderCalendar();
    }
});


// ==========================================
// GLOBAL EVENTS
// ==========================================

document.addEventListener("pointerdown", closeOpenControls);
document.addEventListener("keydown", closeOpenControls);

document.addEventListener("scroll", () => {
    if (openDropdown) {
        positionDropdown(openDropdown.host, openDropdown.menu);
    }

    if (activeDatePicker) {
        positionDatePicker(activeDatePicker);
    }
}, true);

window.addEventListener("resize", () => {
    if (openDropdown) {
        positionDropdown(openDropdown.host, openDropdown.menu);
    }

    if (activeDatePicker) {
        positionDatePicker(activeDatePicker);
    }
});


// ==========================================
// APP INITIALIZATION
// ==========================================

updateDailyQuote();

bindKanbanDropzones();

renderApp();
saveState();

window.setInterval(updateTimer, 250);

scheduleTimerCompletion();

if (state.focusTimer.status === "running") {
    updateTimer();
}

// ==========================================
// WELCOME SCREEN INITIALIZATION
// ==========================================

function initializeWelcomeScreen() {
    const hasStarted =
        sessionStorage.getItem(STARTED_KEY) === "true";

    if (hasStarted) {
        welcomeScreen.hidden = true;
        appShell.hidden = false;

        document.documentElement.classList.add("has-started");

        let lastView =
            sessionStorage.getItem("taskora-last-view") || "home";

        if (lastView === "category") {
            const savedCategoryId =
                sessionStorage.getItem("taskora-last-category");
            const savedCategory = getCategory(savedCategoryId);

            if (savedCategory) {
                selectedCategoryId = savedCategoryId;
            } else {
                lastView = "home";
                sessionStorage.setItem("taskora-last-view", lastView);
                sessionStorage.removeItem("taskora-last-category");
            }
        }

        const validView = [...document.querySelectorAll("[data-view]")]
            .some((view) => view.dataset.view === lastView);

        // First restore the correct page
        showView(validView ? lastView : "home");

        if (validView && lastView === "category" && selectedCategoryId) {
            showCategory(selectedCategoryId);
        }

        // Then reveal the app
        document.documentElement.classList.remove("app-booting");

    } else {
        welcomeScreen.hidden = false;
        appShell.hidden = true;

        document.documentElement.classList.remove(
            "has-started",
            "app-booting"
        );
    }
}

initializeWelcomeScreen();