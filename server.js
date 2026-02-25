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

// ================= START SERVER =================

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running...");
});