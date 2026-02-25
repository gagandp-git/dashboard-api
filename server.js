require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.query(`
  CREATE TABLE IF NOT EXISTS projects (
    id BIGINT PRIMARY KEY,
    description TEXT,
    folder_id BIGINT,
    updated_at TIMESTAMP,
    name TEXT
  );
`).then(() => {
  console.log("Projects table ready");
}).catch(err => {
  console.error("Table creation error:", err);
});

app.post("/api/projects", async (req, res) => {
  try {
    const records = req.body;

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


app.get("/api/projects", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM projects ORDER BY updated_at DESC"
  );
  res.json(result.rows);
});

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running...");
});