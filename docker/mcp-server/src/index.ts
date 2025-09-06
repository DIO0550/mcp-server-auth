import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: /localhost:3\d{3}$/ }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mcp-server" });
});

// TODO: MCP プロトコル実装 & OAuth トークン保持ロジック

const port = process.env.PORT ? Number(process.env.PORT) : 3003;
app.listen(port, () => {
  console.log(`mcp-server listening on ${port}`);
});
