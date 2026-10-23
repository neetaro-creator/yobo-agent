#!/usr/bin/env python3
"""本番の index.html（公開中の版）に、試行版の切り替え層を差し込んで out/index.html を作る。
使い方: python3 -I patch.py <本番のindex.html> <trial_layer.js> <出力のindex.html>
各置換は、元の文字列がちょうど1か所にあることを確かめてから行う。1か所でなければ止まる（本番の版が変わったとき）。
"""
import sys

src, layer, out = sys.argv[1:4]
h = open(src, encoding="utf-8").read()
js = open(layer, encoding="utf-8").read()
assert "</script>" not in js

def sub(old, new, label):
    global h
    n = h.count(old)
    if n != 1:
        sys.exit(f"[{label}] 置換元が {n} か所あります（1か所のはず）")
    h = h.replace(old, new)

# 1) 切り替え層を、本文のスクリプトの前に入れる
first = h.index("<script>")
assert h.count("<script>") == 1, "<script> が複数あります"
h = h[:first] + "<script>\n" + js + "\n</script>\n" + h[first:]

# 2) sample の取得
sub('T0=performance.now();sample=await claude.use("sample");',
    'T0=performance.now();sample=(window.__TRIAL&&await __TRIAL.ready())?__TRIAL.sample:await claude.use("sample");',
    "sample取得")

# 3) 質問タブ
sub('const setStatus=s=>{stEl.textContent=s};',
    'const setStatus=s=>{stEl.textContent=s};const _t0=performance.now();if(window.__TRIAL&&__TRIAL.on)__TRIAL.status=setStatus;',
    "ask:開始")
sub('addHistory({t:Date.now(),q:(o.display||question)+(brief?"（条件："+brief+"）":""),a:text,cites,model:ok?MODEL:"other:"+(r.modelTierApplied||""),asof:IDX.asof});',
    'addHistory({t:Date.now(),q:(o.display||question)+(brief?"（条件："+brief+"）":""),a:text,cites,model:ok?MODEL:"other:"+(r.modelTierApplied||""),asof:IDX.asof});\n'
    '    if(window.__TRIAL&&__TRIAL.on)__TRIAL.record({tab:"質問",q:o.display||question,cond:brief,answer:text,cites,run:sample.lastRun,ms:performance.now()-_t0,model:r.modelApplied||"",after:mn});',
    "ask:成功")
sub('if(e&&e.code==="cancelled"){stEl.textContent="止めました。";if(e.text)ansEl.innerHTML=renderAnswer(e.text)}',
    'if(window.__TRIAL&&__TRIAL.on)__TRIAL.record({tab:"質問",q:o.display||question,cond:brief,answer:(e&&e.text)||text||"",error:(e&&e.code)||"error",run:sample.lastRun,ms:performance.now()-_t0,model:MODEL});\n'
    '    if(e&&e.code==="cancelled"){stEl.textContent="止めました。";if(e.text)ansEl.innerHTML=renderAnswer(e.text)}',
    "ask:失敗")

# 4) 協議タブ：足りない情報を洗い出す
sub('const st=t=>{$("#m-status").textContent=t+(t?"（30秒〜1分ほどです）":"")};st("考えています…");\n  mctl=new AbortController();',
    'const st=t=>{$("#m-status").textContent=t+(t?"（30秒〜1分ほどです）":"")};st("考えています…");\n  mctl=new AbortController();\n'
    '  const _t0=performance.now();let _rq="";if(window.__TRIAL&&__TRIAL.on)__TRIAL.status=t=>st(t);',
    "askBack:開始")
sub('const {u}=memoInputs();', 'const {u}=memoInputs();_rq=u;', "askBack:入力")
sub('renderQs(String(v.view||""),old);st("");\n    $("#m-ask").textContent="さらに洗い出す";',
    'renderQs(String(v.view||""),old);st("");\n    $("#m-ask").textContent="さらに洗い出す";\n'
    '    if(window.__TRIAL&&__TRIAL.on)__TRIAL.record({tab:"協議・洗い出し",q:_rq,answer:JSON.stringify(v,null,1),run:sample.lastRun,ms:performance.now()-_t0,model:MODEL,after:$("#m-qs")});',
    "askBack:成功")
sub('    st(e&&e.code==="cancelled"?"止めました。":e&&e.code==="invalid_json"?"足りない情報の形で',
    '    if(window.__TRIAL&&__TRIAL.on)__TRIAL.record({tab:"協議・洗い出し",q:_rq,answer:(e&&e.text)||"",error:(e&&e.code)||"error",run:sample.lastRun,ms:performance.now()-_t0,model:MODEL});\n'
    '    st(e&&e.code==="cancelled"?"止めました。":e&&e.code==="invalid_json"?"足りない情報の形で',
    "askBack:失敗")

# 5) 協議タブ：確認項目を作る
sub('st("考えています…");$("#m-out").innerHTML="";\n  mctl=new AbortController();',
    'st("考えています…");$("#m-out").innerHTML="";\n  mctl=new AbortController();\n'
    '  const _t0=performance.now();let _rq="";if(window.__TRIAL&&__TRIAL.on){__TRIAL.status=t=>st(t);document.querySelectorAll(\'.trate[data-for="m-out"]\').forEach(x=>x.remove())}',
    "makeMemo:開始")
sub('const {kind,plan,ledger,qa,u}=memoInputs();', 'const {kind,plan,ledger,qa,u}=memoInputs();_rq=u;', "makeMemo:入力")
sub('memoCur=m;saveMemo(m);renderMemo(m);st("");renderMemoHist();',
    'memoCur=m;saveMemo(m);renderMemo(m);st("");renderMemoHist();\n'
    '    if(window.__TRIAL&&__TRIAL.on){const _cs=[...new Set((JSON.stringify(v).match(/\\[\\[\\d+#s\\d+\\]\\]/g)||[]).map(x=>x.slice(2,-2)))].map(k=>{const f=fmtRefLabel(k);return f&&f.row?{ref:k,law:short(f.law.t),label:f.row.label,doc:f.law.ntc?ctxOf(f.law):""}:{ref:k,law:"?",label:"",doc:""}});\n'
    '      __TRIAL.record({tab:"協議・一覧",q:_rq,cond:m.condBrief,answer:JSON.stringify(v,null,1),cites:_cs,run:sample.lastRun,ms:performance.now()-_t0,model:MODEL,after:$("#m-out")})}',
    "makeMemo:成功")
sub('    st(e&&e.code==="cancelled"?"止めました。":e&&e.code==="invalid_json"?"一覧の形で',
    '    if(window.__TRIAL&&__TRIAL.on)__TRIAL.record({tab:"協議・一覧",q:_rq,answer:(e&&e.text)||"",error:(e&&e.code)||"error",run:sample.lastRun,ms:performance.now()-_t0,model:MODEL});\n'
    '    st(e&&e.code==="cancelled"?"止めました。":e&&e.code==="invalid_json"?"一覧の形で',
    "makeMemo:失敗")

open(out, "w", encoding="utf-8").write(h)
print("ok", len(h))
