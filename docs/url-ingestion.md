# 一般公開URLの取得設計

対象は、所有者が管理画面から選んだ一般の公開HTTPS記事です。サイトごとの許可リストを追加する操作は不要です。ログインやブラウザーJavaScriptが必要なページ、画像/PDF解析、非公開記事は対象外です。

## 信頼境界

Cloudflareのhosted Workers security modelは、outbound HTTPをproxyが仲介し、public Internetまたは従来の同一zone originに限定し、実行環境の内部サービスへの到達を除外すると説明しています。`global_fetch_strictly_public` で同一zoneもpublic front door経由にします。

- 入力URLを渡すのは通常のglobal fetchだけ
- VPC networks/services、内部service/origin、Browser Run、proxyのbindingは使わない
- `resolveOverride` や任意のresolverは使わない
- DB/AI/static assetsは明示bindingで使い、入力URLからbindingを選ばせない
- 受信したCookie、Authorization、Access assertionや任意ヘッダーを取得先へ渡さない
- Cloudflareが付与する `CF-Worker` は発信zoneの属性であって認証ではない。所有する別サービスも、このヘッダーだけで権限を与えてはいけない

この前提はCloudflare本番に対するものです。ローカルNode、Miniflare、独自workerdは別のネットワーク設定になり得るため、疑わしい実URLの検証環境には使いません。

## アプリの検査

1. Access JWT署名・issuer・AUD・期限・signed ownerを検証してから処理を始める
2. URLは2048文字以内。HTTPS/443、正規DNS hostnameだけ。認証情報、IPリテラル、encoded authority、内部名、自サイト、既知のsecret query名は拒否
3. 固定 `https://cloudflare-dns.com/dns-query` にAとAAAAを照会。redirect禁止、32KB以内。両方NOERROR、truncationなし、Question一致を要求
4. CNAMEの関連付けを辿り、loop・不明な終点・内部名・無関係なanswerを拒否。全回答のIPを保守的なIANA special-purpose policyで検査し、少なくとも1つの関連公開IPが必要
5. 新規GETを固定Accept/User-Agentのみで取得。redirectは3回まで、毎回URLとDNSを再検査。同じhostnameへのredirectも再照会
6. DNS、redirect、body readerを含む総取得10秒、読込後のHTML 1MB。既知のサイズ超過や拒否のbodyはcancel
7. charsetを復号後parse5で再構成。許可したtext-markupだけを残し、元属性、script/style/meta/base/JSON-LD、image/media/iframe/formなどの外部参照は除去
8. リンクは一時fragmentに置き換え、1MB以内のHTML Blobだけを `AI.toMarkdown` に渡す。画面側の待機30秒、結果200KB以内。安全確認したリンクを戻す
9. Markdown編集後、所有者が公開権利・ライセンス・個人情報を確認して選択公開。HTML表示はraw HTMLを実行せず、外部画像を読まない

特殊用途のglobally-reachable例外も保守的に拒否するため、一部の特殊ネットワーク上のページは取得できません。IPv6はIANA unicast registryのALLOCATED prefix表（2026-10-09確認）から特殊/transition範囲を除いたpolicyです。未割当・reserved spaceも拒否します。IANAの変更時は表と試験を更新します。

## 残る制約

- DoH事前照会とfetchは別の解決。DNS rebinding、resolver差、cacheなどにより、確認したIPと実接続のPUBLIC peerが異なることはあり得る。IP固定や接続peer検査をアプリが保証したものではない
- 内部到達の除外はCloudflareの本番proxyと設定に依存する。プロバイダーの境界不具合、または後からprivate/proxy bindingを入れる変更は、この検査では解消できない
- 公開serverが自身のbackendの情報を返す場合、その出所は証明できない
- 未知のsecretを含むURL path/queryを完全には判定できない。非公開・署名付きURLを入力しない
- GETにも取得先で副作用があり得る。アクセス制限・CAPTCHA・security warning・paywallを回避しない
- 30秒待機timeoutはCloudflareの変換処理のbackend cancellationや利用料金上限を意味しない
- text conversion以外を使わず、CPU・body・時間を制限するが、Worker/D1全体の金額hard capではない

より強い要件として接続時IPの固定・独立検査が必要なら、専用egress gatewayを別途設計します。この個人用リーダーの要件では、上記hosted boundaryを採用します。

## 一次資料

- [Cloudflare hosted security model](https://developers.cloudflare.com/workers/reference/security-model/#api-design)
- [Global fetch strictly public](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
- [BindingとSSRFの説明](https://blog.cloudflare.com/workers-environment-live-object-bindings/)
- [Cloudflare DoH JSON](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)
- [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/)
- [IANA IPv6 global-unicast allocations](https://www.iana.org/assignments/ipv6-unicast-address-assignments/)
- [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/)
- [Static HTML preprocessing](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/)
- [toMarkdown binding](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/)
- [Fetch compression behavior](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
