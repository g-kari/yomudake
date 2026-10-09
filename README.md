# よむだけ

URLをMarkdownに変換し、本文だけを読みやすいHTMLとして公開する個人用リーダー。

## 機能

- 所有者だけの管理画面: 記事URLの変換、Markdown編集、下書き保存、公開・非公開切替
- 公開済み記事はログインなしで閲覧。下書きと管理APIは公開しない
- 元URL・作成日を表示し、Markdown/HTMLで書き出し
- 本文のHTML、スクリプト、フォーム、iframe、外部画像は実行・読込しない

## 現在の状態

Cloudflare Workersへ直接デプロイするコードとテストです。本番Worker、D1、AI binding、管理用Accessアプリはまだ設定・デプロイしていません。実URL変換と本番ログインは未検証です。

一般のURLを読むことが目標ですが、初期のURL取得は許可したホストだけに限定します。任意サイトへの対応が完了した状態ではありません。

URL変換はCloudflare Workers AIの `AI.toMarkdown()` を呼びます。未設定のAI binding、空の取得先許可リスト、未設定の所有者認証は、失敗として止めます。ブラウザー描画による動的ページ取得は含みません。

## 構成

- Cloudflare Worker: 公開記事の読取と所有者限定API
- D1: Markdown本文、公開状態、出典、作成・更新日時
- Workers AI binding: 静的HTML → Markdown。画像・PDFなどのAI解析は対象外
- Cloudflare Access: 管理ルートだけを保護し、Worker内でも署名・発行者・AUD・期限・所有者を検証
- 管理エディター: React。公開記事はクライアントJavaScriptなしで読める

Sitesや特定の他アプリのOAuth、APIトークンには依存しません。

## ローカル検証

Node.js 24以上を使用します。

1. `npm ci`
2. `npm run check`（管理UIの型チェック、合成データのテスト、本番ビルド）
3. 必要なら `npm run types` でWranglerから環境の型を生成

テストは合成記事・合成RSA鍵・SQLite・模擬AI bindingで実行します。実際のCloudflareアカウントに変更を加えず、外部記事を転載しません。

## 本番セットアップ

実行前に、デプロイ先と新規リソース、管理用のAccessポリシー、利用料金・上限を確認します。

1. 新しいWorkerと専用D1を準備し、`migrations/0001_articles.sql` を適用
2. `wrangler.example.jsonc` をローカルの `wrangler.jsonc` にコピーし、実際のD1 IDと承認した独自ホスト名のrouteを設定
3. AI bindingを接続
4. 1つの管理用Accessアプリで `/admin` と `/api/*` の両方を保護し、同じAUDを使用。許可する所有者は1人だけ。公開記事ルート `/p/*` はAccessで囲わない
5. 実行環境に `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`OWNER_EMAIL` を設定。メールや認証情報をリポジトリへ書き込まない
6. `FETCH_ALLOWED_HOSTS` に取得先の正確なホスト名をカンマ区切りで設定。ワイルドカードを使わない
7. 匿名・別ユーザー・偽造JWTの拒否と、所有者の編集を本番で検証してから運用

テンプレートのCPU上限は10msです。これは利用料金の上限ではありません。Worker/D1/AIはそれぞれ無料枠と課金条件があり、全体が無料と確認したものではありません。

`workers.dev` とpreview URLは既定で無効です。`npm run deploy` は未設定のD1/routeを検出して止まります。ソースの公開やPR作成は、本番設定変更・デプロイ・認証権限の作成を意味しません。

## URL取得と変換の制限

- HTTPS、認証情報なし、標準ポート、許可済みの正確なホスト名だけ
- 内部名、IPリテラル、一般的な認証用query名、自己ホスト、未許可のリダイレクトを拒否。queryの名前だけでは、すべての私的・署名付きURLを判定できません。非公開・トークン付きURLは入力しないでください
- 新規GETに固定ヘッダーだけを送る。閲覧者のCookie/Authorizationは渡さない
- 手動リダイレクトは3回まで。転送先を毎回再検査
- 総取得時間10秒、解凍後HTML 1MB、変換後Markdown 200KBまで
- 入力HTMLをparse5で解析し、参照・実行要素や属性を除いてAIへ渡す
- 外部リンクは一時的なローカル参照に置き換え、変換後に検証済みのURLを戻す
- Cloudflareの `global_fetch_strictly_public` を有効化

DNSを先に確認するだけでは、接続先IPを固定できません。この実装は許可したホストの運営者・DNSとCloudflareの公開インターネット向けfetch境界を信頼します。任意ドメインでの厳密な接続時IP制御は保証しません。必要なら接続IPを検証・固定する専用取得gatewayが別途必要です。

Markdownの書き出しは元のMarkdownを保持します。別のMarkdownビューアーではHTMLや画像の扱いが異なる場合があります。

公開前に著作権・ライセンス・個人情報を確認してください。非公開に戻しても、他者が保存したコピーは取り消せません。

## 参考

- [Cloudflare Markdown Conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)
- [AI binding](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/)
- [HTML conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Public-only global fetch](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
