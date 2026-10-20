-- =============================================
-- MGL Progress Tracker - Database Schema
-- =============================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','engineer','architect','senior','client')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Project Members (many-to-many)
CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, user_id)
);

-- Blocks
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Drawings (Ажлын зураг)
CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Components (Зургийн бүрдэл)
CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tasks (Ажил)
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0,
  assigned_to INTEGER REFERENCES users(id),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- SubTasks (Дэд ажил)
CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 0,
  assigned_to INTEGER REFERENCES users(id),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Progress Entries (daily logs)
CREATE TABLE IF NOT EXISTS progress_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  subtask_id INTEGER REFERENCES subtasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  percentage REAL NOT NULL CHECK(percentage >= 0 AND percentage <= 100),
  date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK(
    (task_id IS NOT NULL AND subtask_id IS NULL) OR
    (task_id IS NULL AND subtask_id IS NOT NULL)
  )
);

-- Daily Summaries (Admin consolidated)
CREATE TABLE IF NOT EXISTS daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  total_progress REAL NOT NULL DEFAULT 0,
  block_data TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_project ON blocks(project_id);
CREATE INDEX IF NOT EXISTS idx_drawings_block ON drawings(block_id);
CREATE INDEX IF NOT EXISTS idx_components_drawing ON components(drawing_id);
CREATE INDEX IF NOT EXISTS idx_tasks_component ON tasks(component_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_assigned ON subtasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_progress_task ON progress_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_progress_subtask ON progress_entries(subtask_id);
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_date ON progress_entries(date);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_project ON daily_summaries(project_id);
