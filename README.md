# よむだけ

URLをMarkdownに変換し、本文だけを読みやすいHTMLとして公開する個人用リーダー。

## 機能

- 所有者だけの管理画面: 記事URLの変換、Markdown編集、下書き保存、公開・非公開切替
- 公開済み記事はログインなしで閲覧。下書きと管理APIは公開しない
- 出典の元URL・作成日を表示し、Markdown/HTMLで書き出し
- 外部リンクを開く前に、移動先のサイト名とURLを確認
- 本文のHTML、スクリプト、フォーム、iframe、外部画像は実行・読込しない

## 現在の状態

Cloudflare Workersへ直接デプロイするコードとテストです。リポジトリの `wrangler.jsonc` は本番向け設定（Workers Builds から `npx wrangler deploy` 用）です。実URL変換と本番ログインは未検証です。

一般の公開HTTPS URLを、サイトごとの許可リストなしで取得するコードです。取得前と各転送先でCloudflareの公開DNSを確認し、非公開・特殊用途のIPを拒否します。本番のネットワーク境界と実際の変換はまだ検証していません。

URL変換はCloudflare Workers AIの `AI.toMarkdown()` を呼びます。未設定のAI binding、確認できない公開DNS、未設定の所有者認証は、失敗として止めます。ブラウザー描画による動的ページ取得は含みません。

Xなど、ログイン・ブラウザー描画が必要なページの本文を取得できるとは限りません。X専用の取得APIや代替サービスは接続していません。取得できない場合は本文を直接編集できます。

DNS確認・取得元との通信・Markdown変換サービスの例外を区別し、固定のエラーメッセージと診断コードを返します。上流の例外文、Cookie、トークン、記事本文は応答に含めません。この区別だけで取得元のアクセス制限や変換サービスの障害が解消したことにはなりません。

公開DNS照会はWorkersのnative fetchに対応した `redirect: 'manual'` で実行し、転送応答は拒否します。DNSのQuestionは取得先の正確なホスト名と照合し、末尾のルートdotの有無だけを同一視します。Nodeのmockだけでなく、固定版workerdの合成ネットワークでもDNS照会・転送拒否・非公開IP拒否を検証します。これだけで実X投稿の本文取得・変換成功を確認したことにはなりません。

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

テストは合成記事・合成RSA鍵・SQLite・模擬AI bindingで実行します。固定版Miniflare/workerdのnative fetch試験も、外向き通信を合成handlerへ閉じ込め、実際のCloudflareアカウント・DNS・AIへ接続しません。外部記事を転載しません。

画面の検証は `npm run build` の後、`npx --no-install playwright install --with-deps chromium` と `npm run test:browser` を実行します。固定版 Playwright の Chromium で、320/390/768/1440px、単一本文表示、キーボード、未保存の破棄確認、変換・連続保存・公開を確認します。API はループバック上の合成記事とメモリー内 SQLite だけを使用し、本番 Access・AI・D1 には接続しません。結果と架空データのスクリーンショットは `.sites-runtime/browser/` に保存します。既存 CI の同じジョブで実行し、成果物の保持は3日です。

## 本番セットアップ

実行前に、デプロイ先と新規リソース、管理用のAccessポリシー、利用料金・上限を確認します。

1. 専用D1 `yomudake-articles` と Worker ルートは `wrangler.jsonc` に記載済み。`migrations/0001_articles.sql` は本番 D1 に手動適用済み。**Workers Builds / `wrangler deploy` はマイグレーションを実行しません。** `wrangler d1 migrations apply` を使う場合は、先に `d1_migrations` に `0001` 行を挿入しないと二重適用になる可能性があります。
2. AI bindingは `wrangler.jsonc` の `ai` binding で接続
3. 1つの管理用Accessアプリで `/admin` と `/api/*` の両方を保護し、同じAUDを使用。許可する所有者は1人だけ。公開記事ルート `/p/*` はAccessで囲わない
4. `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` は `wrangler.jsonc` の `vars`。`OWNER_EMAIL` は Worker **secret**（`wrangler secret put OWNER_EMAIL` など）で別途設定し、リポジトリに書かない
5. `global_fetch_strictly_public` を維持し、VPC・内部サービス・Browser Run・proxyのbindingを追加しない。`npm run deploy` または CI の `npx wrangler deploy` 前に `node scripts/require-config.mjs` の preflight を通す
6. 匿名・別ユーザー・偽造JWTの拒否と、所有者の編集を本番で検証してから運用

ローカルだけ別設定にする場合は `wrangler.example.jsonc` を `wrangler.local.jsonc` にコピーして `npm run dev` を使います（`wrangler.local.jsonc` は gitignore 済み）。

テンプレートのCPU上限は10msです。これは利用料金の上限ではありません。Worker/D1/AIはそれぞれ無料枠と課金条件があり、全体が無料と確認したものではありません。

`workers.dev` とpreview URLは既定で無効です。`npm run deploy` は未設定のD1/routeを検出して止まります。ソースの公開やPR作成は、本番設定変更・デプロイ・認証権限の作成を意味しません。

## URL取得と変換の制限

- 一般のHTTPSホスト名、認証情報なし、443番ポートだけ。IPリテラルと非正規のホスト表記は拒否
- 内部名、IPリテラル、一般的な認証用query名、自己ホスト、内部向けリダイレクトを拒否。queryの名前だけでは、すべての私的・署名付きURLを判定できません。非公開・トークン付きURLは入力しないでください
- 新規GETに固定ヘッダーだけを送る。閲覧者のCookie/Authorizationは渡さない
- 手動リダイレクトは3回まで。転送先を毎回再検査
- 固定Cloudflare DoHへA/AAAAの両方を照会し、関連するCNAME転送と全回答IPを検査。DNS失敗・非公開IP混在・無関係な回答は停止
- DNSと転送と本文読込を合わせて10秒、body readerで読んだHTML 1MB、参照除去後HTMLも1MB、変換後Markdown 200KBまで
- 変換の画面側待機は30秒まで。これはCloudflare側処理のキャンセル保証ではない
- HTTPまたは先頭1KBのmeta charset宣言に対応したTextDecoderで本文を復号
- 入力HTMLをparse5で解析し、参照・実行要素や属性を除いてAIへ渡す
- 外部リンクは一時的なローカル参照に置き換え、変換後に検証済みのURLを戻す
- Cloudflareの `global_fetch_strictly_public` を有効化

DNSを先に確認するだけでは、接続先IPを固定できません。DNSの再解決で確認した公開IPと実接続先が変わり得ます。内部到達の最後の境界は、Cloudflare hosted Workersのmediated public Internet fetchとstrictly-public設定に依存します。ローカルNode/Miniflareや独自workerdのネットワーク設定に同じ保証はありません。詳しくは [URL取得の設計](docs/url-ingestion.md) を参照してください。

Markdownの書き出しは本文をそのまま保持し、元URLのある記事には出典リンクと外部リンクの注意書きを先頭に追加します。Markdownビューアーの外部リンクには、このサイトの確認画面を強制できません。HTMLの外部リンクは公開記事の確認画面へ移動します。記事を更新・非公開にした後は古いHTMLのリンクを止め、記事を開き直す案内を表示します。別のMarkdownビューアーではHTMLや画像の扱いが異なる場合があります。

公開前に著作権・ライセンス・個人情報を確認してください。非公開に戻しても、他者が保存したコピーは取り消せません。

## 参考

- [Cloudflare Markdown Conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/)
- [AI binding](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/)
- [HTML conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Hosted Workers security model](https://developers.cloudflare.com/workers/reference/security-model/#api-design)
- [Public-only global fetch](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)

## 外部リンクの確認画面

公開記事の外部リンクは、移動先のサイト名とURLを表示してから開きます。管理画面では下書きを保つdialogで確認します。公開確認画面だけに、指定されたPixiv作品の公式iframeをsandbox付きで表示します。記事・管理画面・HTML書き出し自体にはiframeを読み込まず、既存の管理認証・本文の安全な表示を保ちます。

Pixivの作品本体をこのサイトへコピーしません。確認画面を開いたときはPixivへ接続するため、IPや既存Cookieが届く場合があります。Refererは送りません。作品・作者へのリンクは表示の成否にかかわらず残し、外部リンク先と同じ確認を通します。関連作品の確認済みリストは現在1件だけです。詳しくは [更新記録](docs/release-notes.md) を参照してください。
