# mcp-server-auth

動作確認用リポジトリ

## Dev Container / Docker 開発環境

`/.devcontainer` と `/docker` 以下にローカル検証用の複数サービス構成 (MySQL, auth-server, login-web, api-server, mcp-server) を追加しています。

### 使い方 (VS Code Dev Containers)

1. VS Code でリポジトリを開く
2. コマンドパレット: "Dev Containers: Reopen in Container"
3. コンテナ起動後、自動スクリプトで各サービスのプレースホルダーが用意される
4. 既に `docker-compose.dev.yml` がサービスを起動: `auth-server / login-web / api-server / mcp-server / mysql`

サービス一覧 (デフォルトポート):

- Login Web: http://localhost:3000
- Auth Server: http://localhost:3001
- API Server: http://localhost:3002
- MCP Server: http://localhost:3003
- MySQL: 3306 (app/app)

### サービス実装

現状はプレースホルダー実装 (Health エンドポイントのみ)。OAuth / Firebase 連携やセッション管理をこれから追加してください。

### 今後の拡張案

- pnpm/turborepo によるワークスペース化
- 共通型パッケージの作成 (例: `packages/shared-types`)
- OpenAPI または JSON Schema による API 契約管理
- 本番/ステージング用 compose 差分 (`docker-compose.prod.yml`) 作成
