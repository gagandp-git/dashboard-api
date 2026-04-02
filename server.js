require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const safeTimestamp = (value) => {
  if (!value) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};
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

// Ensure folder_id column exists
const ensureRecipesTable = async () => {
  try {
    await pool.query(`
      ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS folder_id BIGINT
    `);

    console.log("✅ folder_id column ensured in recipes table");
  } catch (err) {
    console.error("Error ensuring column:", err);
  }
};

ensureRecipesTable();

// ================= BASIC TEST ROUTES =================

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ message: "API working ✅" });
});

// ================= CREATE TABLE IF NOT EXISTS =================
// ================= RESET + CREATE JOBS TABLE =================

pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        completed_at TIMESTAMP,
        started_at TIMESTAMP,
        title TEXT,
        is_poll_error BOOLEAN,
        error TEXT,
        is_error BOOLEAN,
        status TEXT,
        calling_recipe_id TEXT,
        calling_job_id TEXT,
        recipe_id TEXT,
        root_recipe_id TEXT,
        root_job_id TEXT,
        master_job_id TEXT,
        job_succeeded_count INTEGER,
        job_failed_count INTEGER,
        job_count INTEGER,
        job_scope_count INTEGER
      );
    `).then(() => console.log("Projects table ready"))
.catch(err => console.error("Table creation error:", err));
  

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
  CREATE TABLE IF NOT EXISTS folders (
    id BIGINT PRIMARY KEY,
    name TEXT,
    parent_id BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    project_id BIGINT,
    is_project BOOLEAN
  );
`)
.then(() => console.log("Folders table ready"))
.catch(err => console.error("Folders table creation error:", err));

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
`)
.then(() => console.log("Recipes table ready"))
.catch(err => console.error("Recipes table creation error:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT PRIMARY KEY,
    timestamp TIMESTAMP,
    event_type TEXT,
    workspace_id BIGINT,
    workspace_name TEXT,
    workspace_environment TEXT,
    user_id BIGINT,
    user_name TEXT,
    user_email TEXT,
    resource_id BIGINT,
    resource_name TEXT,
    resource_type TEXT,
    resource_path TEXT,
    resource_folder_id BIGINT,
    details JSONB
  );
`)
.then(() => console.log("Audit logs table ready"))
.catch(err => console.error("Audit logs table creation error:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS recipe_connections (
    id SERIAL PRIMARY KEY,
    recipe_id BIGINT,
    recipe_name TEXT,
    connection_id BIGINT,
    connection_name TEXT,
    application TEXT
  );
`)
.then(async () => {
  await pool.query(`ALTER TABLE recipe_connections ADD COLUMN IF NOT EXISTS application TEXT`);
  console.log("Recipe connections table ready");
})
.catch(err => console.error("Recipe connections table creation error:", err));
// ================= WORKATO SYNC ENDPOINT =================

// Workato will POST array of records here
app.post("/api/projects", async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    for (const record of items) {
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

app.post("/api/folders", async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    for (const folder of items) {
      await pool.query(
        `
        INSERT INTO folders (id, name, parent_id, created_at, updated_at, project_id, is_project)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          parent_id = EXCLUDED.parent_id,
          updated_at = EXCLUDED.updated_at,
          project_id = EXCLUDED.project_id,
          is_project = EXCLUDED.is_project;
        `,
        [
          folder.id,
          folder.name,
          folder.parent_id || null,
          folder.created_at || null,
          folder.updated_at || null,
          folder.project_id || null,
          folder.is_project || false
        ]
      );
    }

    res.json({ message: "Folders synced successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sync folders" });
  }
});

app.post("/api/jobs", async (req, res) => {
  try {
    const {
      items,
      job_succeeded_count,
      job_failed_count,
      job_count,
      job_scope_count
    } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    for (const j of items) {
      await pool.query(
  `INSERT INTO jobs (
    id,
    completed_at,
    started_at,
    title,
    is_poll_error,
    error,
    is_error,
    status,
    calling_recipe_id,
    calling_job_id,
    recipe_id,
    root_recipe_id,
    root_job_id,
    master_job_id,
    job_succeeded_count,
    job_failed_count,
    job_count,
    job_scope_count
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
  )
  ON CONFLICT (id) DO UPDATE SET
    completed_at = EXCLUDED.completed_at,
    started_at = EXCLUDED.started_at,
    title = EXCLUDED.title,
    is_poll_error = EXCLUDED.is_poll_error,
    error = EXCLUDED.error,
    is_error = EXCLUDED.is_error,
    status = EXCLUDED.status,
    calling_recipe_id = EXCLUDED.calling_recipe_id,
    calling_job_id = EXCLUDED.calling_job_id,
    recipe_id = EXCLUDED.recipe_id,
    root_recipe_id = EXCLUDED.root_recipe_id,
    root_job_id = EXCLUDED.root_job_id,
    master_job_id = EXCLUDED.master_job_id,
    job_succeeded_count = EXCLUDED.job_succeeded_count,
    job_failed_count = EXCLUDED.job_failed_count,
    job_count = EXCLUDED.job_count,
    job_scope_count = EXCLUDED.job_scope_count;
  `,
  [
    j.id,
    j.completed_at || null,
    j.started_at || null,
    j.title || null,
    j.is_poll_error ?? null,
    j.error || null,
    j.is_error ?? null,
    j.status || null,
    j.calling_recipe_id || null,
    j.calling_job_id || null,
    j.recipe_id?.toString() || null,
    j.root_recipe_id || null,
    j.root_job_id || null,
    j.master_job_id || null,
    job_succeeded_count ?? 0,
    job_failed_count ?? 0,
    job_count ?? 0,
    job_scope_count ?? 0
  ]
);
    }

    res.json({ message: "Jobs synced successfully" });

  } catch (error) {
    console.error("Jobs Sync Error:", error);
    res.status(500).json({ error: "Failed to sync jobs" });
  }
});

app.post("/api/connections", async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload" });
    }
const safeTimestamp = (value) => {
      if (!value) return null;
      if (typeof value === "string" && value.trim() === "") return null;
      return value;
    };
      for (const r of items) {
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
  r.name || null,
  r.description || null,
  safeTimestamp(r.authorized_at),
  r.authorization_status || null,
  r.authorization_error || null,
  safeTimestamp(r.created_at),
  safeTimestamp(r.updated_at),
  r.external_id || null,
  r.folder_id || null,
  safeTimestamp(r.connection_lost_at),
  r.connection_lost_reason || null,
  r.parent_id || null
]
      );
    }

    res.json({ message: "Connections synced" });
  } catch (error) {
  console.error("FULL ERROR:", error);
  res.status(500).json({ error: error.message });
}
});

app.post("/api/recipes", async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const safeTimestamp = (value) => {
      if (!value) return null;
      if (typeof value === "string" && value.trim() === "") return null;
      return value;
    };

    for (const r of items) {

      // Skip empty objects
      if (!r.id) continue;

      await pool.query(
        `INSERT INTO recipes (
          id,
          name,
          project_id,
          folder_id,
          running,
          job_succeeded_count,
          job_failed_count,
          last_run_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          project_id = EXCLUDED.project_id,
          folder_id = EXCLUDED.folder_id,
          running = EXCLUDED.running,
          job_succeeded_count = EXCLUDED.job_succeeded_count,
          job_failed_count = EXCLUDED.job_failed_count,
          last_run_at = EXCLUDED.last_run_at,
          updated_at = EXCLUDED.updated_at`,
        [
          r.id,
          r.name || null,
          r.project_id || null,
          r.folder_id || null,   // 👈 NEW FIELD
          r.running === true || r.running === "true",
          r.job_succeeded_count ?? 0,
          r.job_failed_count ?? 0,
          safeTimestamp(r.last_run_at),
          safeTimestamp(r.updated_at)
        ]
      );
    }

    res.json({ message: "Recipes saved successfully" });

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/audit_logs", async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload, expected { items: [...] }" });
    }
    for (const item of items) {
      await pool.query(
        `INSERT INTO audit_logs (
          id, timestamp, event_type,
          workspace_id, workspace_name, workspace_environment,
          user_id, user_name, user_email,
          resource_id, resource_name, resource_type, resource_path, resource_folder_id,
          details
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET
          event_type = EXCLUDED.event_type,
          timestamp = EXCLUDED.timestamp,
          user_name = EXCLUDED.user_name,
          resource_name = EXCLUDED.resource_name,
          details = EXCLUDED.details`,
        [
          item.id,
          item.timestamp || null,
          item.event_type || null,
          item.workspace?.id || null,
          item.workspace?.name || null,
          item.workspace?.environment || null,
          item.user?.id || null,
          item.user?.name || null,
          item.user?.email || null,
          item.resource?.id || null,
          item.resource?.name || null,
          item.resource?.type || null,
          item.resource?.path || null,
          item.resource?.folder_id || null,
          JSON.stringify(item.details || {})
        ]
      );
    }
    res.json({ message: "Audit logs synced successfully" });
  } catch (error) {
    console.error("Audit logs error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/audit_logs", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM audit_logs ORDER BY timestamp DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

app.post("/api/recipe_connections", async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    for (const item of items) {
      await pool.query(
        `INSERT INTO recipe_connections (recipe_id, recipe_name, connection_id, connection_name, application)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          item.recipe_id,
          item.recipe_name || null,
          item.connection_id || null,
          item.connection_name || null,
          item.application || null
        ]
      );
    }

    res.json({ message: "Recipe connections synced successfully" });

  } catch (error) {
    console.error("Recipe connections error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/recipe_connections", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM recipe_connections ORDER BY recipe_id");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch recipe connections" });
  }
});

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

app.get("/api/folders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM folders ORDER BY updated_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch folders" });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM jobs");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
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