import React, { useEffect, useState } from "react";

// Daily Study Tracker with:
// - Continuous daily timer (start/pause)
// - JSON persistence in localStorage
// - Study To-Dos
// - Weekly dashboard (last 7 days)
// - Daily goal & progress
// - Weekly goal (editable)
// - Current session timer
// - Streak counter

const STORAGE_KEY = "study_timer_data_v3";
const PRODUCTIVE_MINUTES_FOR_STREAK = 30; // min minutes per day to count as a "productive" day

function getDateKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10); // YYYY-MM-DD
}

function getDefaultSettings() {
  return {
    dailyGoalMinutes: 240, // 4 hours
    weeklyGoalHours: 20,
  };
}

function getEmptyData() {
  return {
    version: 3,
    days: {}, // { [dateKey]: { segments: [{ start, end }] } }
    currentSession: null, // { dateKey, start }
    todos: [], // { id, text, done }
    settings: getDefaultSettings(),
  };
}

function loadInitialData() {
  if (typeof window === "undefined") return getEmptyData();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getEmptyData();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return getEmptyData();

    if (!parsed.days || typeof parsed.days !== "object") {
      parsed.days = {};
    }
    if (!Array.isArray(parsed.todos)) {
      parsed.todos = [];
    }
    if (!parsed.settings || typeof parsed.settings !== "object") {
      parsed.settings = getDefaultSettings();
    } else {
      // fill missing setting fields
      const defaults = getDefaultSettings();
      parsed.settings = { ...defaults, ...parsed.settings };
    }
    parsed.version = 3;

    return parsed;
  } catch (e) {
    console.error("Failed to load study timer data", e);
    return getEmptyData();
  }
}

function saveData(data) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save study timer data", e);
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function getTotalMsForDate(data, dateKey, now) {
  const day = data.days[dateKey];
  if (!day) return 0;

  let total = 0;
  if (Array.isArray(day.segments)) {
    for (const seg of day.segments) {
      if (typeof seg.start === "number" && typeof seg.end === "number") {
        total += Math.max(0, seg.end - seg.start);
      }
    }
  }

  if (data.currentSession && data.currentSession.dateKey === dateKey) {
    total += Math.max(0, now - data.currentSession.start);
  }

  return total;
}

function getCurrentSessionMs(data, now) {
  if (!data.currentSession) return 0;
  return Math.max(0, now - data.currentSession.start);
}

function getPrettyDateLabel(dateKey, todayKey) {
  if (dateKey === todayKey) return "Today";

  const today = new Date(todayKey);
  const d = new Date(dateKey);
  const diffDays = Math.round(
    (today.setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0)) /
      (1000 * 60 * 60 * 24)
  );

  if (diffDays === 1) return "Yesterday";
  return dateKey;
}

function computeCurrentStreak(data, now) {
  const todayKey = getDateKey(now);
  const thresholdMs = PRODUCTIVE_MINUTES_FOR_STREAK * 60 * 1000;
  let streak = 0;

  const d = new Date(todayKey);
  // Try up to 365 days back just to be safe
  for (let i = 0; i < 365; i++) {
    const dateKey = d.toISOString().slice(0, 10);
    const totalMs = getTotalMsForDate(data, dateKey, now);
    if (totalMs >= thresholdMs) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export default function App() {
  const [data, setData] = useState(() => loadInitialData());
  const [now, setNow] = useState(Date.now());
  const [newTodoText, setNewTodoText] = useState("");

  // Tick every second to update the UI
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Persist to localStorage whenever data changes
  useEffect(() => {
    saveData(data);
  }, [data]);

  const todayKey = getDateKey(now);
  const isRunning = !!data.currentSession;
  const todayTotalMs = getTotalMsForDate(data, todayKey, now);
  const currentSessionMs = getCurrentSessionMs(data, now);

  // History and weekly stats
  const allDateKeys = Object.keys(data.days).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0
  );
  const historyItems = allDateKeys.slice(0, 7).map((dateKey) => {
    const totalMs = getTotalMsForDate(data, dateKey, now);
    return { dateKey, totalMs };
  });

  const weeklyTotalMs = historyItems.reduce(
    (sum, item) => sum + item.totalMs,
    0
  );

  const dailyGoalMinutes = data.settings?.dailyGoalMinutes ?? 240;
  const weeklyGoalHours = data.settings?.weeklyGoalHours ?? 20;

  const dailyGoalMs = dailyGoalMinutes * 60 * 1000;
  const weeklyGoalMs = weeklyGoalHours * 60 * 60 * 1000;

  const dailyProgress = dailyGoalMs
    ? Math.min(100, Math.round((todayTotalMs / dailyGoalMs) * 100))
    : 0;
  const weeklyProgress = weeklyGoalMs
    ? Math.min(100, Math.round((weeklyTotalMs / weeklyGoalMs) * 100))
    : 0;

  const currentStreak = computeCurrentStreak(data, now);

  // Handlers
  const handleStart = () => {
    if (isRunning) return; // already running
    const startTime = Date.now();
    const dateKey = getDateKey(startTime);

    setData((prev) => {
      const next = {
        ...prev,
        days: { ...prev.days },
      };
      if (!next.days[dateKey]) {
        next.days[dateKey] = { segments: [] };
      }
      next.currentSession = { dateKey, start: startTime };
      return next;
    });
  };

  const handlePause = () => {
    if (!isRunning) return;

    setData((prev) => {
      if (!prev.currentSession) return prev;

      const endTime = Date.now();
      const { dateKey, start } = prev.currentSession;
      const day = prev.days[dateKey] || { segments: [] };
      const newSegments = Array.isArray(day.segments) ? [...day.segments] : [];

      if (endTime > start) {
        newSegments.push({ start, end: endTime });
      }

      return {
        ...prev,
        days: {
          ...prev.days,
          [dateKey]: {
            segments: newSegments,
          },
        },
        currentSession: null,
      };
    });
  };

  const handleResetToday = () => {
    const confirmReset = window.confirm(
      "This will clear all study time for today. Are you sure?"
    );
    if (!confirmReset) return;

    setData((prev) => {
      const next = { ...prev, days: { ...prev.days } };
      next.days[todayKey] = { segments: [] };

      if (next.currentSession && next.currentSession.dateKey === todayKey) {
        next.currentSession = null;
      }

      return next;
    });
  };

  // Todo handlers
  const handleAddTodo = (e) => {
    e.preventDefault();
    const text = newTodoText.trim();
    if (!text) return;

    setData((prev) => ({
      ...prev,
      todos: [
        ...(Array.isArray(prev.todos) ? prev.todos : []),
        { id: Date.now(), text, done: false },
      ],
    }));
    setNewTodoText("");
  };

  const toggleTodo = (id) => {
    setData((prev) => ({
      ...prev,
      todos: (prev.todos || []).map((t) =>
        t.id === id ? { ...t, done: !t.done } : t
      ),
    }));
  };

  const deleteTodo = (id) => {
    setData((prev) => ({
      ...prev,
      todos: (prev.todos || []).filter((t) => t.id !== id),
    }));
  };

  const clearCompletedTodos = () => {
    setData((prev) => ({
      ...prev,
      todos: (prev.todos || []).filter((t) => !t.done),
    }));
  };

  const handleDailyGoalChange = (e) => {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    const minutes = Math.max(0, Math.min(24 * 60, value)); // 0 to 1440
    setData((prev) => ({
      ...prev,
      settings: {
        ...getDefaultSettings(),
        ...(prev.settings || {}),
        dailyGoalMinutes: minutes,
      },
    }));
  };

  const handleWeeklyGoalChange = (e) => {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    const hours = Math.max(0, Math.min(168, value)); // 0 to 168
    setData((prev) => ({
      ...prev,
      settings: {
        ...getDefaultSettings(),
        ...(prev.settings || {}),
        weeklyGoalHours: hours,
      },
    }));
  };

  const completedTodos = (data.todos || []).filter((t) => t.done).length;
  const totalTodos = (data.todos || []).length;

  return (
    <div className="app-root">
      <div className="timer-card">
        <h1 className="app-title">Daily Study Tracker</h1>
        <p className="app-subtitle">
          Track your actual study time, manage tasks, and see your daily & weekly
          progress.
        </p>

        <div className="timer-display">{formatDuration(todayTotalMs)}</div>
        <div className="timer-label">
          {isRunning ? "Tracking study time..." : "Paused"}
        </div>
        {isRunning && (
          <div className="session-label">
            Current session:{" "}
            <strong>{formatDuration(currentSessionMs)}</strong>
          </div>
        )}

        <div className="controls">
          <button
            className="btn primary"
            onClick={handleStart}
            disabled={isRunning}
          >
            {isRunning ? "Running" : "Start / Resume"}
          </button>
          <button className="btn" onClick={handlePause} disabled={!isRunning}>
            Pause for Break
          </button>
          <button className="btn danger" onClick={handleResetToday}>
            Reset Today
          </button>
        </div>

        <div className="goals-row">
          <div className="goal-block">
            <div className="goal-header">
              <span>Daily goal</span>
              <input
                type="number"
                className="goal-input"
                value={dailyGoalMinutes}
                onChange={handleDailyGoalChange}
              />
              <span className="goal-unit">min</span>
            </div>
            <div className="progress-bar-track thin">
              <div
                className="progress-bar-fill"
                style={{ width: `${dailyProgress}%` }}
              />
            </div>
            <div className="goal-label">
              {dailyProgress}% of daily goal
            </div>
          </div>

          <div className="goal-block">
            <div className="goal-header">
              <span>Weekly goal</span>
              <input
                type="number"
                className="goal-input"
                value={weeklyGoalHours}
                onChange={handleWeeklyGoalChange}
              />
              <span className="goal-unit">h</span>
            </div>
            <div className="progress-bar-track thin">
              <div
                className="progress-bar-fill blue"
                style={{ width: `${weeklyProgress}%` }}
              />
            </div>
            <div className="goal-label">
              {weeklyProgress}% of weekly goal
            </div>
          </div>
        </div>

        <div className="today-summary">
          <h2>Today</h2>
          <p>
            You have studied <strong>{formatDuration(todayTotalMs)}</strong> so
            far on <strong>{todayKey}</strong>.
          </p>
          <p className="tip">
            Tip: Keep this tab open while studying. Hit "Pause for Break" when
            you stop.
          </p>
          <p className="streak">
            Current streak:{" "}
            <strong>{currentStreak}</strong>{" "}
            {currentStreak === 1 ? "day" : "days"} (≥{" "}
            {PRODUCTIVE_MINUTES_FOR_STREAK} min/day)
          </p>
        </div>

        <div className="layout-split">
          {/* TODO section */}
          <section className="todo-section">
            <div className="section-header">
              <h2>Study To-Dos</h2>
              <span className="todo-count">
                {completedTodos}/{totalTodos} done
              </span>
            </div>

            <form className="todo-form" onSubmit={handleAddTodo}>
              <input
                className="todo-input"
                type="text"
                placeholder="Add a task (e.g. DSA revision, OS notes)"
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
              />
              <button className="btn small primary" type="submit">
                Add
              </button>
            </form>

            <div className="todo-actions">
              <button
                className="btn small"
                type="button"
                onClick={clearCompletedTodos}
                disabled={completedTodos === 0}
              >
                Clear completed
              </button>
            </div>

            <ul className="todo-list">
              {(data.todos || []).length === 0 && (
                <li className="todo-empty">
                  No tasks yet. Add your first one.
                </li>
              )}
              {(data.todos || []).map((todo) => (
                <li
                  key={todo.id}
                  className={`todo-item ${todo.done ? "done" : ""}`}
                >
                  <label className="todo-label">
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={() => toggleTodo(todo.id)}
                    />
                    <span>{todo.text}</span>
                  </label>
                  <button
                    type="button"
                    className="todo-delete"
                    onClick={() => deleteTodo(todo.id)}
                    aria-label="Delete task"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Weekly section */}
          <section className="weekly-section">
            <h2>Weekly Dashboard</h2>
            <p className="weekly-text">
              Last 7 days total:{" "}
              <strong>{formatDuration(weeklyTotalMs)}</strong>
            </p>
            <div className="progress-bar-wrapper">
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${weeklyProgress}%` }}
                />
              </div>
              <span className="progress-label">{weeklyProgress}%</span>
            </div>

            <div className="history">
              <h3>Recent Days</h3>
              {historyItems.length === 0 ? (
                <p className="empty">
                  No history yet. Start studying to track time.
                </p>
              ) : (
                <ul>
                  {historyItems.map((item) => (
                    <li key={item.dateKey} className="history-item">
                      <span className="history-date">
                        {getPrettyDateLabel(item.dateKey, todayKey)}
                      </span>
                      <span className="history-time">
                        {formatDuration(item.totalMs)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      <style>{`
        .app-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0f172a;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #e5e7eb;
          padding: 16px;
        }

        .timer-card {
          background: #020617;
          border-radius: 24px;
          padding: 24px 24px 20px;
          max-width: 980px;
          width: 100%;
          box-shadow: 0 20px 40px rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(148, 163, 184, 0.2);
        }

        .app-title {
          margin: 0 0 4px;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: 0.03em;
        }

        .app-subtitle {
          margin: 0 0 20px;
          font-size: 13px;
          color: #9ca3af;
        }

        .timer-display {
          font-size: 48px;
          font-weight: 700;
          text-align: center;
          margin-bottom: 4px;
          letter-spacing: 0.06em;
        }

        .timer-label {
          text-align: center;
          font-size: 13px;
          color: #9ca3af;
          margin-bottom: 4px;
        }

        .session-label {
          text-align: center;
          font-size: 12px;
          color: #a5b4fc;
          margin-bottom: 12px;
        }

        .controls {
          display: flex;
          gap: 8px;
          justify-content: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }

        .btn {
          border: none;
          border-radius: 999px;
          padding: 8px 14px;
          font-size: 13px;
          cursor: pointer;
          background: #020617;
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, 0.5);
          transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease, border-color 0.15s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        .btn.small {
          padding: 6px 10px;
          font-size: 12px;
        }

        .btn.primary {
          background: #22c55e;
          border-color: #22c55e;
          color: #022c22;
          font-weight: 600;
        }

        .btn.danger {
          border-color: #f97373;
          color: #fecaca;
        }

        .btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.7);
          background: #020617;
        }

        .btn.primary:hover:not(:disabled) {
          background: #16a34a;
          border-color: #16a34a;
        }

        .btn.danger:hover:not(:disabled) {
          background: #7f1d1d;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: default;
          box-shadow: none;
          transform: none;
        }

        .goals-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }

        .goal-block {
          padding: 10px;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(31, 41, 55, 0.9);
          font-size: 12px;
        }

        .goal-header {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 4px;
        }

        .goal-input {
          width: 64px;
          border-radius: 999px;
          border: 1px solid rgba(55, 65, 81, 0.9);
          background: #020617;
          padding: 2px 6px;
          font-size: 12px;
          color: #e5e7eb;
          text-align: right;
        }

        .goal-input:focus {
          outline: none;
          border-color: #22c55e;
          box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.5);
        }

        .goal-unit {
          color: #9ca3af;
        }

        .progress-bar-track {
          flex: 1;
          height: 8px;
          border-radius: 999px;
          background: #020617;
          border: 1px solid rgba(55, 65, 81, 0.9);
          overflow: hidden;
        }

        .progress-bar-track.thin {
          height: 6px;
          margin-bottom: 2px;
        }

        .progress-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #22c55e, #3b82f6);
          transition: width 0.2s ease;
        }

        .progress-bar-fill.blue {
          background: linear-gradient(90deg, #3b82f6, #22c55e);
        }

        .goal-label {
          margin-top: 2px;
          font-size: 11px;
          color: #9ca3af;
        }

        .today-summary {
          margin-bottom: 16px;
          padding: 12px 12px 10px;
          border-radius: 16px;
          background: radial-gradient(circle at top left, rgba(52, 211, 153, 0.14), transparent 55%),
                      radial-gradient(circle at bottom right, rgba(96, 165, 250, 0.08), transparent 55%);
          border: 1px solid rgba(148, 163, 184, 0.3);
        }

        .today-summary h2 {
          margin: 0 0 4px;
          font-size: 15px;
        }

        .today-summary p {
          margin: 0 0 4px;
          font-size: 13px;
          color: #d1d5db;
        }

        .today-summary .tip {
          font-size: 12px;
          color: #9ca3af;
        }

        .today-summary .streak {
          font-size: 12px;
          color: #a5b4fc;
          margin-top: 4px;
        }

        .layout-split {
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          gap: 16px;
          margin-top: 10px;
        }

        .todo-section,
        .weekly-section {
          border-radius: 16px;
          padding: 12px 12px 10px;
          background: rgba(15, 23, 42, 0.96);
          border: 1px solid rgba(31, 41, 55, 0.9);
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .todo-section h2,
        .weekly-section h2 {
          margin: 0;
          font-size: 15px;
        }

        .todo-count {
          font-size: 12px;
          color: #9ca3af;
        }

        .todo-form {
          display: flex;
          gap: 6px;
          margin-bottom: 6px;
        }

        .todo-input {
          flex: 1;
          border-radius: 999px;
          border: 1px solid rgba(55, 65, 81, 0.9);
          background: #020617;
          padding: 7px 10px;
          font-size: 13px;
          color: #e5e7eb;
        }

        .todo-input::placeholder {
          color: #6b7280;
        }

        .todo-input:focus {
          outline: none;
          border-color: #22c55e;
          box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.5);
        }

        .todo-actions {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 6px;
        }

        .todo-list {
          list-style: none;
          margin: 0;
          padding: 0;
          max-height: 180px;
          overflow-y: auto;
        }

        .todo-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 8px;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(31, 41, 55, 0.9);
          font-size: 13px;
          margin-bottom: 4px;
        }

        .todo-item.done span {
          text-decoration: line-through;
          color: #6b7280;
        }

        .todo-label {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .todo-label input[type="checkbox"] {
          width: 14px;
          height: 14px;
        }

        .todo-delete {
          border: none;
          background: transparent;
          color: #9ca3af;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
        }

        .todo-delete:hover {
          color: #fecaca;
        }

        .todo-empty {
          font-size: 13px;
          color: #9ca3af;
        }

        .weekly-text {
          margin: 0 0 4px;
          font-size: 13px;
          color: #d1d5db;
        }

        .progress-bar-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 6px 0 10px;
        }

        .progress-label {
          font-size: 12px;
          color: #9ca3af;
          width: 38px;
          text-align: right;
        }

        .history {
          margin-top: 6px;
        }

        .history h3 {
          margin: 0 0 6px;
          font-size: 13px;
        }

        .history ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .history-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 6px;
          border-radius: 8px;
          font-size: 12px;
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(31, 41, 55, 0.9);
          margin-bottom: 3px;
        }

        .history-date {
          color: #e5e7eb;
        }

        .history-time {
          font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          color: #a5b4fc;
        }

        .empty {
          font-size: 13px;
          color: #9ca3af;
        }

        @media (max-width: 768px) {
          .timer-card {
            padding: 18px 16px 16px;
          }

          .timer-display {
            font-size: 40px;
          }

          .layout-split {
            grid-template-columns: 1fr;
          }

          .goals-row {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 480px) {
          .controls {
            flex-direction: column;
          }

          .btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
