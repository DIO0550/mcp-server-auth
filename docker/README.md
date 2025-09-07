# Docker / Dev Container セットアップ

## 前提

- VS Code + Dev Containers 拡張機能
- Docker Desktop

## 起動手順

1. コマンドパレットで "Dev Containers: Reopen in Container" を実行
2. dev コンテナ起動後、自動で `post-create.sh` が各サービスのプレースホルダーを生成
3. 別ターミナルで (必要なら) `docker compose -f docker/docker-compose.dev.yml up --build`

VS Code の Dev Container 内では `mysql`, 各 Node サービスにホストからアクセス可能:

- Login Web: http://localhost:5173
- Auth Server: http://localhost:3001
- API Server: http://localhost:3002
- MCP Server: http://localhost:3003
- MySQL: localhost:3306 (user: app / pass: app / db: app)

## ディレクトリ構成

```
.devcontainer/
  devcontainer.json
/docker
  docker-compose.dev.yml
  auth-server/
  login-web/
  api-server/
  mcp-server/
  mysql/
  shared/post-create.sh
```

## 次のステップ

- 各サービスに実際の `package.json` と実装 (TypeScript) を追加
- 共通で使う型や環境変数の管理方法を検討 (例: pnpm workspaces / turborepo)
- Firebase ログイン画面でのトークン発行と Auth Server 間のセッション連携
