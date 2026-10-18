# よむだけ

URLをMarkdownに変換し、本文だけを読みやすいHTMLとして公開する個人用リーダー。

## 機能

- 所有者だけの管理画面: 記事URLの変換、Markdown編集、下書き保存、公開・非公開切替
- 公開前の出典・ライセンス・個人情報の確認は、タイトル・本文・元URLを変更すると解除。変更後の内容を確認し直してから公開し、下書き保存は確認なしで利用できます
- 管理画面の保存記事を100件ずつ切り替え、101件目以降の古い記事も開いて編集。ページ切替は編集中の下書きを保持

- 所有者用MCP: `/api/mcp` でURL変換・下書き保存・一件読取・明示的な公開。既存Access署名検証を維持し、変換だけでは公開しない。[接続方法と制限](docs/mcp.md)
- 公開済み記事はログインなしで閲覧。下書きと管理APIは公開しない
- 出典の元URL・作成日を表示し、Markdown/HTMLで書き出し
- 本文に見出しが2つ以上ある記事は、折り畳める目次から節へ移動。公開記事とHTML書き出しはJavaScriptなしで使える
- 外部リンクを開く前に、移動先のサイト名とURLを確認
- 本文のHTML、スクリプト、フォーム、iframe、外部画像は実行・読込しない

## 現在の状態

Cloudflare Workersへ直接デプロイするコードとテストです。リポジトリの `wrangler.jsonc` は本番向け設定（Workers Builds から `pnpm exec wrangler deploy` 用）です。実URL変換と本番ログインは未検証です。

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

pnpm 11.25.0を使用します。未導入なら `npm install --global pnpm@11.25.0` で固定版を準備してください。依存関係は `pnpm-lock.yaml` を正として、CIと同じfrozen installを使います。Node.jsの既存要件は変更しません。

1. `pnpm install --frozen-lockfile`
2. `pnpm run check`（管理UIの型チェック、合成データのテスト、本番ビルド）
3. 必要なら `pnpm run types` でWranglerから環境の型を生成

テストは合成記事・合成RSA鍵・SQLite・模擬AI bindingで実行します。固定版Miniflare/workerdのnative fetch試験も、外向き通信を合成handlerへ閉じ込め、実際のCloudflareアカウント・DNS・AIへ接続しません。外部記事を転載しません。

画面の検証は `pnpm run build` の後、`pnpm exec playwright install --with-deps chromium` と `pnpm run test:browser` を実行します。固定版 Playwright の Chromium で、320/390/768/1440px、単一本文表示、キーボード、未保存の破棄確認、変換・連続保存・公開を確認します。API はループバック上の合成記事とメモリー内 SQLite だけを使用し、本番 Access・AI・D1 には接続しません。結果と架空データのスクリーンショットは `.sites-runtime/browser/` に保存します。既存 CI の同じジョブで実行し、成果物の保持は3日です。

## 保存記事のページ切替

管理画面の「以前の記事のページ」「新しい記事のページ」で、更新日時の新しい順に100件ずつ表示します。同じ更新日時の記事はIDの降順で並べ、一覧には現在のページだけを保持します。ページ切替はタイトル・Markdown・出典・公開確認・表示タブ・未保存の警告を変更しません。別の記事を開くときは、従来どおり未保存の変更の破棄を確認します。

一覧の取得と応答本文の読込は15秒で待機を終了します。時間切れでも直前のページと編集中の本文を残し、保存後の一覧更新なら保存済みの確認を保持して編集を再開できます。一覧の読取だけを中断し、保存処理を再送しません。

取得に失敗しても直前のページを残し、「記事一覧を再読み込み」で失敗したページを再試行できます。保存が成功した後の一覧は先頭のページから更新します。保存後に一覧だけが失敗した場合も、保存済みの確認と新しい入力を保持します。

ページ指定は最大512文字の不透明なcursorで、SQLが返す行は次のページの有無を調べる1件を含め最大101件です。既存のschemaに更新日時・IDの索引は追加しないため、走査行数やD1の課金対象の読取行数が101件以内になる保証ではありません。cursorは署名済み認証情報ではなく、所有者認証の後に検証する読取位置です。公開トップの最新100件、公開記事・書き出し、認証、変換、保存データの形式は変更しません。

複数タブ・別端末で一覧の途中に保存すると、更新された記事は新しい位置へ移動します。一覧全体を同一時点に固定する仕組みではありません。最新状態から見直す場合は新しい記事のページに戻るか、管理画面を開き直してください。

ページ切替のbrowser回帰は、205件の合成SQLite記事と実際にビルドしたWorker・エディターを使い、既存の `pnpm run test:browser` で実行します。新しいページ試験だけの予定は `node tests/browser/article-pagination.mjs --list` で確認できます。予定の表示は画面の実行結果ではありません。

## 本番セットアップ

実行前に、デプロイ先と新規リソース、管理用のAccessポリシー、利用料金・上限を確認します。

1. 専用D1 `yomudake-articles` と Worker ルートは `wrangler.jsonc` に記載済み。`migrations/0001_articles.sql` は本番 D1 に手動適用済み。**Workers Builds / `wrangler deploy` はマイグレーションを実行しません。** `wrangler d1 migrations apply` を使う場合は、先に `d1_migrations` に `0001` 行を挿入しないと二重適用になる可能性があります。
2. AI bindingは `wrangler.jsonc` の `ai` binding で接続
3. 1つの管理用Accessアプリで `/admin` と `/api/*` の両方を保護し、同じAUDを使用。許可する所有者は1人だけ。公開記事ルート `/p/*` はAccessで囲わない
4. `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` は `wrangler.jsonc` の `vars`。`OWNER_EMAIL` は Worker **secret**（`wrangler secret put OWNER_EMAIL` など）で別途設定し、リポジトリに書かない
5. `global_fetch_strictly_public` を維持し、VPC・内部サービス・Browser Run・proxyのbindingを追加しない。`pnpm run deploy` または CI の `pnpm exec wrangler deploy` 前に `node scripts/require-config.mjs` の preflight を通す
6. 匿名・別ユーザー・偽造JWTの拒否と、所有者の編集を本番で検証してから運用

ローカルだけ別設定にする場合は `wrangler.example.jsonc` を `wrangler.local.jsonc` にコピーして `pnpm run dev` を使います（`wrangler.local.jsonc` は gitignore 済み）。

テンプレートのCPU上限は10msです。これは利用料金の上限ではありません。Worker/D1/AIはそれぞれ無料枠と課金条件があり、全体が無料と確認したものではありません。

`workers.dev` とpreview URLは既定で無効です。`pnpm run deploy` は未設定のD1/routeを検出して止まります。ソースの公開やPR作成は、本番設定変更・デプロイ・認証権限の作成を意味しません。

## URL取得と変換の制限

- 一般のHTTPSホスト名、認証情報なし、443番ポートだけ。IPリテラルと非正規のホスト表記は拒否
- 内部名、IPリテラル、一般的な認証用query名、自己ホスト、内部向けリダイレクトを拒否。queryの名前だけでは、すべての私的・署名付きURLを判定できません。非公開・トークン付きURLは入力しないでください
- 新規GETに固定ヘッダーだけを送る。閲覧者のCookie/Authorizationは渡さない
- 手動リダイレクトは3回まで。転送先を毎回再検査
- 固定Cloudflare DoHへA/AAAAの両方を照会し、関連するCNAME転送と全回答IPを検査。DNS失敗・非公開IP混在・無関係な回答は停止
- DNSと転送と本文読込を合わせて10秒、body readerで読んだHTML 1MB、参照除去後HTMLも1MB、変換後Markdown 200KBまで
- WorkerがAI変換の結果を待つ時間は30秒まで。先行する取得処理の10秒制限とは別の段階
- 管理画面は変換リクエストの開始から応答JSONの読込まで60秒で待機を終了。時間切れでも編集中の本文・出典・公開状態を保持し、編集へ戻れます。自動再試行や保存は行いません
- どちらの待機上限もCloudflare側処理のキャンセルや利用料金の上限を保証しません。再試行は時間を置いて明示的に操作してください
- HTTPまたは先頭1KBのmeta charset宣言に対応したTextDecoderで本文を復号
- 入力HTMLをparse5で解析し、参照・実行要素や属性を除いてAIへ渡す
- 外部リンクは一時的なローカル参照に置き換え、変換後に検証済みのURLを戻す
- Cloudflareの `global_fetch_strictly_public` を有効化

DNSを先に確認するだけでは、接続先IPを固定できません。DNSの再解決で確認した公開IPと実接続先が変わり得ます。内部到達の最後の境界は、Cloudflare hosted Workersのmediated public Internet fetchとstrictly-public設定に依存します。ローカルNode/Miniflareや独自workerdのネットワーク設定に同じ保証はありません。詳しくは [URL取得の設計](docs/url-ingestion.md) を参照してください。

Markdownの書き出しは本文をそのまま保持し、元URLのある記事には出典リンクと外部リンクの注意書きを先頭に追加します。Markdownビューアーの外部リンクには、このサイトの確認画面を強制できません。HTMLの外部リンクは公開記事の確認画面へ移動します。記事を更新・非公開にした後は古いHTMLのリンクを止め、記事を開き直す案内を表示します。別のMarkdownビューアーではHTMLや画像の扱いが異なる場合があります。

目次は、このサイトのMarkdown表示で実際に見出しになる行だけを使います。コードブロック内の見出し文字列は含めず、重複する日本語見出しにも別の移動先を付けます。目次のラベルは文字だけで、本文の外部リンクを直接開きません。見出しの移動先は現在の本文順に `#yomu-section-1` から割り当てるため、見出しを追加・削除・並べ替えると番号が変わります。見出しがない記事と1つだけの記事には目次を出しません。元のMarkdownや保存データは変更しません。

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
