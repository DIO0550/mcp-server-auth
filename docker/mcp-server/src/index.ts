import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { z } from "zod";
import express from "express";
import { Request, Response } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import cors from "cors";
import { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mcp-server" });
});

// Streamable HTTP Transport (stateless mode: sessionIdGenerator: undefined)
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
const BeforeValue: { [sessionId: string]: number } = {};

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

// セッションごとの前回値を保持するストア
// key: sessionId, value: 直近の数値
// 既存の BeforeValue オブジェクトを利用
mcpServer.registerTool(
  "mul_with_previous",
  {
    description: "同じセッションで前回値と現在値を掛け算して返す",
    inputSchema: {
      value: z.number().describe("現在の数値"),
    },
  },
  async ({ value }, extra) => {
    const sid = extra.sessionId || "stateless";
    const prev = BeforeValue[sid];
    const result = typeof prev === "number" ? prev * value : value;
    BeforeValue[sid] = value;
    return {
      content: [{ type: "text", text: String(result) }],
    };
  }
);

let authMiddleware = null;
// Create auth middleware for MCP endpoints
const mcpServerUrl = new URL(`http://localhost:3003/mcp`);
const authServerUrl = new URL(`http://localhost:3001/oauth/`);

// Fixed OAuth settings (no CLI flags)
const strictOAuth = false;
// const useOAuth = true; // reserved if you later toggle middleware

/**
 * Build OAuth 2.0 Authorization Server metadata from a base auth server URL.
 *
 * The provided `authServerUrl` should point to the base path under which the
 * authorization server exposes its endpoints (e.g. http://localhost:3002/auth).
 * This function will derive standard endpoint URLs from it.
 */
function setupAuthServer(options: {
  authServerUrl: URL;
  mcpServerUrl: URL;
  strictResource?: boolean;
}): OAuthMetadata {
  const { authServerUrl } = options;

  // Derive endpoints relative to the provided base path
  const authorization_endpoint = new URL("authorize", authServerUrl).toString();
  const token_endpoint = new URL("token", authServerUrl).toString();
  const revocation_endpoint = new URL("revoke", authServerUrl).toString();
  const introspection_endpoint = new URL(
    "introspect",
    authServerUrl
  ).toString();
  const registration_endpoint = new URL("register", authServerUrl).toString();

  // Issuer should be an origin-like identifier. Use the origin of the auth server.
  const issuer = authServerUrl.origin;

  const metadata: OAuthMetadata = {
    issuer,
    authorization_endpoint,
    token_endpoint,
    registration_endpoint,
    revocation_endpoint,
    introspection_endpoint,
    // Minimal set suitable for Authorization Code + PKCE flows
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Our demo auth server supports at least plain; advertise S256 if upstream supports it
    code_challenge_methods_supported: ["plain", "S256"],
    // Public clients typically use none; extend as needed for confidential clients
    token_endpoint_auth_methods_supported: ["none"],
  } as OAuthMetadata;

  return metadata;
}

const oauthMetadata: OAuthMetadata = setupAuthServer({
  authServerUrl,
  mcpServerUrl,
  strictResource: strictOAuth,
});

function checkResourceAllowed(options: {
  requestedResource: string | string[];
  configuredResource: URL;
}): boolean {
  const expected = new URL(String(options.configuredResource));
  const expectedStr = expected.toString();
  const toMatch = (val: string) => {
    try {
      const u = new URL(val);
      return u.toString() === expectedStr;
    } catch {
      return val === expectedStr;
    }
  };
  if (Array.isArray(options.requestedResource)) {
    return options.requestedResource.some(toMatch);
  }
  return toMatch(options.requestedResource);
}

const tokenVerifier = {
  verifyAccessToken: async (token: string) => {
    const endpoint = oauthMetadata.introspection_endpoint;

    if (!endpoint) {
      throw new Error("No token verification endpoint available in metadata");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: token,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Invalid or expired token: ${await response.text()}`);
    }

    const data = await response.json();

    if (strictOAuth) {
      if (!data.aud) {
        throw new Error(`Resource Indicator (RFC8707) missing`);
      }
      if (
        !checkResourceAllowed({
          requestedResource: data.aud,
          configuredResource: mcpServerUrl,
        })
      ) {
        throw new Error(
          `Expected resource indicator ${mcpServerUrl}, got: ${data.aud}`
        );
      }
    }

    // Convert the response to AuthInfo format
    return {
      token,
      clientId: data.client_id,
      scopes: data.scope ? data.scope.split(" ") : [],
      expiresAt: data.exp,
    };
  },
};
// Add metadata routes to the main MCP server
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpServerUrl,
    scopesSupported: ["mcp:tools"],
    resourceName: "MCP Demo Server",
  })
);

authMiddleware = requireBearerAuth({
  verifier: tokenVerifier,
  requiredScopes: [],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
});

app.post("/mcp", async (req: Request, res: Response) => {
  // 既に起動時に connect 済み。ここではリクエスト処理のみ。

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    console.log(`Received MCP request for session: ${sessionId}`);
  } else {
    console.log("Request body:", req.body);
  }

  try {
    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID when session is initialized
          // This avoids race conditions where requests might come in before the session is stored
          console.log(`Session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        },
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(
            `Transport closed for session ${sid}, removing from transports map`
          );
          delete transports[sid];
        }
      };

      await mcpServer.server.connect(transport);

      await transport.handleRequest(req, res, req.body);
      return; // Already handled
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    // Handle the request with existing transport - no need to reconnect
    // The existing transport is already connected to the server
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
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

app.use(
  cors({
    origin: "*", // Allow all origins
    exposedHeaders: ["Mcp-Session-Id"],
  })
);

// 起動時に一度だけ transport を MCP サーバーへ接続

app
  .listen(port, () => {
    console.log(`MCP Streamable HTTP Server listening on port ${port}`);
  })
  .on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
