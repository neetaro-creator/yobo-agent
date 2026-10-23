/**
 * 例規ナビ 試行版：Claude の中継と、記録のスプレッドシートへの書き込み。
 *
 * 置き場所：スプレッドシート「例規ナビ_試行記録」に紐づいた Apps Script（拡張機能 → Apps Script）。
 * APIキー：プロジェクトの設定 → スクリプト プロパティ に ANTHROPIC_API_KEY を入れる（コードには書かない）。
 * デプロイ：ウェブアプリ。次のユーザーとして実行＝自分、アクセスできるユーザー＝全員。
 *
 * 動作（POST、本文は JSON 文字列。Content-Type は text/plain で送られる）
 *   {action:"claude", body:{model, max_tokens, system, messages, tools, tool_choice}} → Anthropic API の応答をそのまま返す
 *   {action:"log", rec:{...}}                  → 「記録」シートに1行足し、その行の id を返す
 *   {action:"rate", id, rating, correct}       → その id の行の「評価」「正しい答え」を書き換える
 *
 * 回数の上限・合言葉・ログインは付けていない。代わりに、URL を知っている人が他の用途に使えないよう、
 * 使えるモデルを1つに固定し、max_tokens と本文の大きさに上限を置いている。
 * 費用の歯止めは Anthropic の Console で月の使用額の上限を設定すること。
 */

const MODEL_OK = ['claude-sonnet-5-5'];
const MAX_TOKENS_CAP = 16000;
const MAX_BODY_CHARS = 8000000;
const CELL_MAX = 45000;
const SHEET_NAME = '記録';
const HEAD = ['ID', '日時', 'タブ', '質問', '条件', '回答', '根拠', '調べた回数', '打ち切り', '時間（秒）', 'トークン数', '評価', '正しい答え', 'モデル'];
// 列の型：t=文字、n=数値
const COLS = ['t', 't', 't', 't', 't', 't', 't', 'n', 't', 'n', 'n', 't', 't', 't'];

function doGet() {
  return json_({ ok: true, service: 'reiki-navi-trial' });
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw) return json_({ ok: false, status: 400, error: 'empty' });
    if (raw.length > MAX_BODY_CHARS) return json_({ ok: false, status: 413, error: 'too_large' });
    const req = JSON.parse(raw);
    if (req.action === 'claude') return json_(callClaude_(req.body || {}));
    if (req.action === 'log') return json_(appendLog_(req.rec || {}));
    if (req.action === 'rate') return json_(rate_(req));
    return json_({ ok: false, status: 400, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, status: 500, error: String((err && err.message) || err).slice(0, 300) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function callClaude_(b) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, status: 500, error: 'no_key' };
  if (MODEL_OK.indexOf(b.model) < 0) return { ok: false, status: 400, error: 'model_not_allowed' };
  const body = {
    model: b.model,
    max_tokens: Math.min(Number(b.max_tokens) || 8000, MAX_TOKENS_CAP),
    messages: b.messages
  };
  if (b.system) body.system = b.system;
  if (b.tools && b.tools.length) body.tools = b.tools;
  if (b.tool_choice) body.tool_choice = b.tool_choice;
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 200 && code < 300) return { ok: true, data: JSON.parse(text) };
  return { ok: false, status: code, error: text.slice(0, 600) };
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function clip_(v) {
  const s = v == null ? '' : String(v);
  return s.length > CELL_MAX ? s.slice(0, CELL_MAX) + '…（以下省略）' : s;
}

function appendLog_(r) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const id = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    const vals = [
      id, now, clip_(r.tab), clip_(r.q), clip_(r.cond), clip_(r.answer), clip_(r.cites),
      Number(r.rounds) || 0, clip_(r.cut), Number(r.secs) || 0, Number(r.tokens) || 0,
      clip_(r.rating), clip_(r.correct), clip_(r.model)
    ];
    const row = sh.getLastRow() + 1;
    const rg = sh.getRange(row, 1, 1, HEAD.length);
    rg.setNumberFormats([COLS.map(function (t) { return t === 't' ? '@' : '0'; })]);
    rg.setValues([vals]);
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function rate_(req) {
  const id = String(req.id || '');
  if (!id) return { ok: false, status: 400, error: 'no_id' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const hit = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).createTextFinder(id).matchEntireCell(true).findNext();
    if (!hit) return { ok: false, status: 404, error: 'id_not_found' };
    const row = hit.getRow();
    const rg = sh.getRange(row, 12, 1, 2);
    rg.setNumberFormats([['@', '@']]);
    rg.setValues([[clip_(req.rating), clip_(req.correct)]]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 初回だけ、エディタでこの関数を実行して権限を許可する（外部への接続・スプレッドシートの編集）。 */
function authorize() {
  UrlFetchApp.fetch('https://api.anthropic.com/', { muteHttpExceptions: true });
  sheet_();
  Logger.log('許可できました。キーの有無：' + (PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') ? 'あり' : 'なし'));
}

/** デプロイ後の確認用。エディタで実行すると、短い質問を Claude に送って結果をログに出す。 */
function selfTest() {
  const r = callClaude_({
    model: MODEL_OK[0],
    max_tokens: 50,
    messages: [{ role: 'user', content: '「はい」とだけ答えてください。' }]
  });
  Logger.log(JSON.stringify(r).slice(0, 500));
}
