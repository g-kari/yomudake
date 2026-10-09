export const MAX_MARKDOWN_BYTES = 200000;
export function isOwnerIdentity(user, ownerEmail) {
  return Boolean(ownerEmail && user?.userId && user?.email && user.email.toLowerCase() === ownerEmail.trim().toLowerCase());
}
export function safeHttpUrl(value) {
  if (!value || typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host.includes(':') || host.startsWith('[') || host === 'localhost' || /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host)) return null;
    // URL normalizes non-canonical numeric IPv4 forms before this test.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a,b] = host.split('.').map(Number);
      if (a===0 || a===10 || a===127 || a===169 && b===254 || a===172 && b>=16 && b<=31 || a===192 && b===168 || a===100 && b>=64 && b<=127 || a>=224 || a===192 && b===0 || a===198 && (b===18||b===19)) return null;
    }
    return url.href;
  } catch { return null; }
}
export function isSameOriginMutation(request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  return Boolean(origin && origin === new URL(request.url).origin && (!site || site === 'same-origin' || site === 'none') && request.headers.get('content-type')?.startsWith('application/json'));
}
export function validateArticleInput(value) {
  if (!value || typeof value !== 'object') return { error: '入力を確認してください。' };
  if (typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) return { error: '記事IDが不正です。' };
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) return { error: 'タイトルは160文字以内で入力してください。' };
  if (typeof value.markdown !== 'string' || !value.markdown.trim() || new TextEncoder().encode(value.markdown).length > MAX_MARKDOWN_BYTES) return { error: 'Markdownは空にせず、200KB以内で入力してください。' };
  const source = value.sourceUrl || '';
  if (typeof source !== 'string' || source && !safeHttpUrl(source)) return { error: '元URLには公開されたHTTP/HTTPSのURLを指定してください。認証情報付き・内部向けURLは使えません。' };
  if (typeof value.published !== 'boolean') return {error:'公開状態が不正です。'};
  if (value.published && value.rightsConfirmed !== true) return { error: '公開できる本文か、出典とライセンスを確認してください。' };
  return { article: {id:value.id, title:value.title.trim(),markdown:value.markdown,sourceUrl:source ? safeHttpUrl(source) : '', published:value.published} };
}
