require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

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
    const { id, description, folder_id, updated_at, name } = req.body;

    const result = await pool.query(
      `INSERT INTO projects (id, description, folder_id, updated_at, name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, description, folder_id, updated_at, name]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Insert failed" });
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