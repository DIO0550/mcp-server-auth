/**
 * シンプル検証用 OAuth (Auth Code + PKCE) 実装
 * - メモリ保持 / 最低限の処理のみ
 * - PKCE: plain のみ (S256 は TODO)
 * - 本番用途のバリデーション/セキュリティは未実装
 */
import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";

type PendingAuth = {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  createdAt: number;
  userId?: string;
};

type TokenRecord = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  scope: string[];
  createdAt: number;
  expiresIn: number;
};

// メモリ上の保存 (再起動で消える)
const pendingAuths = new Map<string, PendingAuth>();
const authCodes = new Map<
  string,
  {
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    createdAt: number;
  }
>();
const tokens = new Map<string, TokenRecord>();

const app = express();

app.use(cors({ origin: /localhost:3\d{3}$/, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "auth-server" });
});

/**
 * 1) 認可エンドポイント (Authorization Code + PKCE 最小実装)
 *  - /oauth/authorize
 *  - クエリ: response_type=code, client_id, redirect_uri, state, code_challenge?, code_challenge_method?
 *  - ユーザー未ログインなら login_required を返し、/login を促す
 */
app.get("/oauth/authorize", (req: Request, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
  } = req.query as Record<string, string | undefined>;
  if (response_type !== "code") {
    return res.status(400).json({ error: "unsupported_response_type" });
  }
  if (!client_id || !redirect_uri || !state)
    return res.status(400).json({ error: "invalid_request" });
  const uid = req.cookies["uid"] as string | undefined;
  pendingAuths.set(state, {
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    createdAt: Date.now(),
    userId: uid,
  });

  if (!uid) {
    return res.status(200).json({
      status: "login_required",
      login_hint:
        'POST /login {"email": "you@example.com", "state": "<state from query>"}',
      state,
    });
  }
  const code = randomUUID();
  const rec = pendingAuths.get(state);
  if (!rec) return res.status(400).json({ error: "invalid_state" });
  authCodes.set(code, {
    userId: uid,
    clientId: rec.clientId,
    redirectUri: rec.redirectUri,
    codeChallenge: rec.codeChallenge,
    codeChallengeMethod: rec.codeChallengeMethod,
    createdAt: Date.now(),
  });
  const redirectUrl = new URL(rec.redirectUri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", state);
  return res.json({ status: "authorized", redirect: redirectUrl.toString() });
});

/**
 * 2) ログイン (簡略版)
 *  実際には Firebase などの ID トークンを受け取り verify → userId 解決
 *  今回は email 文字列だけでダミー userId を組み立て Cookie に保存
 */
app.post("/login", (req: Request, res: Response) => {
  const { email, state } = req.body as { email?: string; state?: string };
  if (!email) return res.status(400).json({ error: "email_required" });
  // デモ: email 文字列から簡易 userId を生成
  const userId = `user_${Buffer.from(email).toString("hex").slice(0, 8)}`;
  res.cookie("uid", userId, { httpOnly: true });
  if (state) {
    const pending = pendingAuths.get(state);
    if (pending) {
      pending.userId = userId;
    }
  }
  return res.json({ status: "logged_in", userId });
});

// トークン発行 (authorization_code)
app.post("/oauth/token", (req: Request, res: Response) => {
  const { grant_type, code, redirect_uri, code_verifier } = req.body as Record<
    string,
    string | undefined
  >;
  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }
  if (!code || !redirect_uri)
    return res.status(400).json({ error: "invalid_request" });
  const stored = authCodes.get(code);
  if (!stored) return res.status(400).json({ error: "invalid_code" });
  if (stored.redirectUri !== redirect_uri)
    return res.status(400).json({ error: "redirect_uri_mismatch" });
  // PKCE 検証 (plain のみ) S256 は未実装
  if (stored.codeChallenge) {
    if (!code_verifier)
      return res.status(400).json({ error: "missing_code_verifier" });
    if (stored.codeChallengeMethod === "S256") {
      // TODO: S256 (code_verifier を SHA256→base64url に変換して比較) を実装する
    } else {
      if (stored.codeChallenge !== code_verifier)
        return res.status(400).json({ error: "invalid_code_verifier" });
    }
  }
  authCodes.delete(code);
  const accessToken = randomUUID();
  const refreshToken = randomUUID();
  const expiresIn = 3600;
  tokens.set(accessToken, {
    accessToken,
    refreshToken,
    userId: stored.userId,
    scope: [],
    createdAt: Date.now(),
    expiresIn,
  });
  return res.json({
    token_type: "Bearer",
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
  });
});

// introspect もどき (active 判定のみ)
app.post("/oauth/introspect", (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ active: false });
  const rec = tokens.get(token);
  if (!rec) return res.json({ active: false });
  const expired = Date.now() > rec.createdAt + rec.expiresIn * 1000;
  if (expired) return res.json({ active: false });
  return res.json({
    active: true,
    user_id: rec.userId,
    scope: rec.scope.join(" "),
    exp: Math.floor((rec.createdAt + rec.expiresIn * 1000) / 1000),
  });
});

// リフレッシュ (refresh_token 再利用型)
app.post("/oauth/refresh", (req: Request, res: Response) => {
  const { refresh_token } = req.body as { refresh_token?: string };
  if (!refresh_token) return res.status(400).json({ error: "invalid_request" });
  // デモのため線形探索 (件数少前提)
  let found: TokenRecord | undefined;
  for (const rec of tokens.values()) {
    if (rec.refreshToken === refresh_token) {
      found = rec;
      break;
    }
  }
  if (!found) return res.status(400).json({ error: "invalid_refresh_token" });
  const newAccess = randomUUID();
  const expiresIn = 3600;
  tokens.set(newAccess, {
    accessToken: newAccess,
    refreshToken: refresh_token,
    userId: found.userId,
    scope: found.scope,
    createdAt: Date.now(),
    expiresIn,
  });
  return res.json({
    token_type: "Bearer",
    access_token: newAccess,
    refresh_token: refresh_token,
    expires_in: expiresIn,
  });
});

// ログアウト (Cookie 削除のみ)
app.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("uid");
  return res.json({ status: "logged_out" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(port, () => console.log(`[auth-server] port=${port}`));
