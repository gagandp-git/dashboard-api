require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// ================= DATABASE CONNECTION =================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ================= BASIC TEST ROUTES =================

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ message: "API working ✅" });
});

// ================= CREATE TABLE IF NOT EXISTS =================

pool.query(`
  CREATE TABLE IF NOT EXISTS projects (
    id BIGINT PRIMARY KEY,
    description TEXT,
    folder_id BIGINT,
    updated_at TIMESTAMP,
    name TEXT
  );
`)
.then(() => console.log("Projects table ready"))
.catch(err => console.error("Table creation error:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    completed_at TIMESTAMP,
    started_at TIMESTAMP,
    title TEXT,
    is_poll_error TEXT,
    error TEXT,
    is_error TEXT,
    status TEXT,
    calling_recipe_id TEXT,
    calling_job_id TEXT,
    recipe_id TEXT,
    root_recipe_id TEXT,
    root_job_id TEXT
  );
`).then(() => console.log("Jobs table ready"))
.catch(err => console.error("Table creation error:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS connections (
    id BIGINT PRIMARY KEY,
    application TEXT,
    name TEXT,
    description TEXT,
    authorized_at TIMESTAMP,
    authorization_status TEXT,
    authorization_error TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    external_id TEXT,
    folder_id BIGINT,
    connection_lost_at TIMESTAMP,
    connection_lost_reason TEXT,
    parent_id TEXT
  );
`)
.then(() => console.log("Connections table ready"))
.catch(err => console.error("Table creation error:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY,
    name TEXT,
    project_id INTEGER,
    running BOOLEAN,
    job_succeeded_count INTEGER,
    job_failed_count INTEGER,
    last_run_at TIMESTAMP,
    updated_at TIMESTAMP
  );
`).then(() => console.log("Recipes table ready"))
.catch(err => console.error("Table creation error:", err));
// ================= WORKATO SYNC ENDPOINT =================

// Workato will POST array of records here
app.post("/api/projects", async (req, res) => {
  try {
    const records = req.body;

    if (!Array.isArray(records)) {
      return res.status(400).json({ error: "Expected array of records" });
    }

    for (const record of records) {
      const { id, description, folder_id, updated_at, name } = record;

      await pool.query(
        `
        INSERT INTO projects (id, description, folder_id, updated_at, name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id)
        DO UPDATE SET
          description = EXCLUDED.description,
          folder_id = EXCLUDED.folder_id,
          updated_at = EXCLUDED.updated_at,
          name = EXCLUDED.name;
        `,
        [id, description, folder_id, updated_at, name]
      );
    }

    res.json({ message: "Batch sync successful" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Batch insert failed" });
  }
});

app.post("/api/jobs", async (req, res) => {
  try {
    const records = req.body;

    for (const r of records) {
      await pool.query(
        `
        INSERT INTO jobs (
          id, completed_at, started_at, title, is_poll_error,
          error, is_error, status,
          calling_recipe_id, calling_job_id,
          recipe_id, root_recipe_id, root_job_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at;
        `,
        [
          r.id,
          r.completed_at,
          r.started_at,
          r.title,
          r.is_poll_error,
          r.error,
          r.is_error,
          r.status,
          r.calling_recipe_id,
          r.calling_job_id,
          r.recipe_id,
          r.root_recipe_id,
          r.root_job_id
        ]
      );
    }

    res.json({ message: "Jobs synced" });
  } catch (err) {
    res.status(500).json({ error: "Failed to sync jobs" });
  }
});

app.post("/api/connections", async (req, res) => {
  try {
    const records = req.body;

    for (const r of records) {
      await pool.query(
        `
        INSERT INTO connections (
          id, application, name, description,
          authorized_at, authorization_status,
          authorization_error, created_at, updated_at,
          external_id, folder_id,
          connection_lost_at, connection_lost_reason, parent_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
          authorization_status = EXCLUDED.authorization_status,
          updated_at = EXCLUDED.updated_at;
        `,
        [
          r.id,
          r.application,
          r.name,
          r.description,
          r.authorized_at,
          r.authorization_status,
          r.authorization_error,
          r.created_at,
          r.updated_at,
          r.external_id,
          r.folder_id,
          r.connection_lost_at,
          r.connection_lost_reason,
          r.parent_id
        ]
      );
    }

    res.json({ message: "Connections synced" });
  } catch (err) {
    res.status(500).json({ error: "Failed to sync connections" });
  }
});

app.post("/api/recipes", async (req, res) => {
  try {
    const records = req.body;

    for (const r of records) {
      await pool.query(
        `
        INSERT INTO recipes (
          id, name, project_id,
          running, job_succeeded_count,
          job_failed_count, last_run_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          running = EXCLUDED.running,
          job_succeeded_count = EXCLUDED.job_succeeded_count,
          job_failed_count = EXCLUDED.job_failed_count,
          updated_at = EXCLUDED.updated_at;
        `,
        [
          r.id,
          r.name,
          r.project_id,
          r.running,
          r.job_succeeded_count,
          r.job_failed_count,
          r.last_run_at,
          r.updated_at
        ]
      );
    }

    res.json({ message: "Recipes synced" });
  } catch (err) {
    res.status(500).json({ error: "Failed to sync recipes" });
  }
});

// ================= FETCH DATA FOR DASHBOARD =================

app.get("/api/projects", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM projects ORDER BY updated_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

app.get("/api/jobs", async (req, res) => {
  const result = await pool.query("SELECT * FROM jobs");
  res.json(result.rows);
});

app.get("/api/connections", async (req, res) => {
  const result = await pool.query("SELECT * FROM connections");
  res.json(result.rows);
});

app.get("/api/recipes", async (req, res) => {
  const result = await pool.query("SELECT * FROM recipes");
  res.json(result.rows);
});

// ================= START SERVER =================

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running...");
});