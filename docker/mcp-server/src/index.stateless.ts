import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";
import { Request, Response } from "express";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mcp-server" });
});

// Streamable HTTP Transport (stateless mode: sessionIdGenerator: undefined)
const transport: StreamableHTTPServerTransport =
  new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

const mcpServer = new McpServer({
  name: "StreamableHttpsServer",
  version: "0.0.1",
});

mcpServer.registerTool(
  "double",
  {
    description: "数値を2倍にするツール",
    inputSchema: {
      value: z.number().describe("2倍にする数値"),
    },
  },
  async ({ value }) => {
    return {
      content: [{ type: "text", text: String(value * 2) }],
    };
  }
);

app.post("/mcp", async (req: Request, res: Response) => {
  // 既に起動時に connect 済み。ここではリクエスト処理のみ。
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (_: Request, res: Response) => {
  console.log("Received GET MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

// Session termination not needed in stateless mode
app.delete("/mcp", async (req: Request, res: Response) => {
  console.log("Received DELETE MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

// TODO: MCP プロトコル実装 & OAuth トークン保持ロジック

const port = process.env.PORT ? Number(process.env.PORT) : 3003;
// 起動時に一度だけ transport を MCP サーバーへ接続
async function bootstrap() {
  await mcpServer.connect(transport);
  const server = app.listen(port, () => {
    console.log(
      `MCP Stateless Streamable HTTP Server listening on port ${port}`
    );
  });

  server.on("error", (err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    try {
      await transport.close();
      await mcpServer.close();
    } finally {
      server.close(() => process.exit(0));
      // 念のため 5 秒で強制終了
      setTimeout(() => process.exit(1), 5000).unref();
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((e) => {
  console.error("Bootstrap failed", e);
  process.exit(1);
});
// 以前は各リクエスト毎に connect/close していたため初期化中に終了し 500 となっていた。
