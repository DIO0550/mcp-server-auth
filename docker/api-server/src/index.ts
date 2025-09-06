import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: /localhost:3\d{3}$/ }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "api-server" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3002;
app.listen(port, () => {
  console.log(`api-server listening on ${port}`);
});
