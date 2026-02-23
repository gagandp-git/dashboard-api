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
  CREATE TABLE IF NOT EXISTS records (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    project VARCHAR(100),
    status VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).then(() => {
  console.log("Table ready");
}).catch(err => {
  console.error("Table creation error:", err);
});

app.post("/webhook", async (req, res) => {
  try {
    const { name, project, status } = req.body;

    await pool.query(
      "INSERT INTO records (name, project, status) VALUES ($1, $2, $3)",
      [name, project, status]
    );

    res.json({ message: "Data saved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});


app.get("/api/data", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM records ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running...");
});