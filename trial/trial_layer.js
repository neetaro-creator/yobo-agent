/* ============================================================
   試行版の切り替え層
   同じフォルダに config.json があり、その中の api（GAS の URL）が入っているときだけ有効になる。
   無いとき（claude.ai の本番）は何もせず、本番と同じに動く。
   有効なとき：
     - Claude の呼び出し（sample / sample.json）を GAS 経由の Anthropic API に差し替える。
       ツール（検索・読み取り）はこのページの中で動かし、結果を API に返す。
     - 質問・回答・根拠・調べた回数などを、GAS 経由でスプレッドシートに記録する。
     - 回答の下に「役に立った／誤りがある」と「正しい答え」の欄を出す。
   ============================================================ */
(function(){
const T=window.__TRIAL={on:false,cfg:null,sample:null,status:null,_p:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const isAbort=e=>!!e&&(e.name==="AbortError"||e.code==="cancelled");

async function gasPost(payload,signal){
  let last=null;
  for(let i=0;i<2;i++){
    try{
      const r=await fetch(T.cfg.api,{method:"POST",body:JSON.stringify(payload),signal});
      if(!r.ok)throw {code:"upstream_error",detail:"http "+r.status};
      const j=await r.json();
      if(j&&j.ok===false&&(j.status>=500||j.status===529)&&i===0){last={code:"upstream_error",detail:j.error};await sleep(2500);continue}
      return j;
    }catch(e){
      if(isAbort(e))throw {code:"cancelled"};
      last=e&&e.code?e:{code:"upstream_error",detail:String((e&&e.message)||e)};
      if(i===0){await sleep(2500);continue}
      throw last;
    }
  }
  throw last||{code:"upstream_error"};
}
function apiErr(res){
  const s=res.status,msg=String(res.error||"");
  if(s===429)return {code:"rate_limited",detail:msg};
  if(s===413||(s===400&&/prompt is too long|too_large|too large/i.test(msg)))return {code:"prompt_too_large",detail:msg};
  if(s===400)return {code:"invalid_request",detail:msg};
  return {code:"upstream_error",detail:msg};
}
function parseJSON(t){
  t=String(t||"").trim();
  const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f)t=f[1].trim();
  try{return JSON.parse(t)}catch(_){}
  const a=t.indexOf("{"),b=t.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1))}catch(_){}}
  return null;
}
const withCache=ms=>{
  const c=JSON.parse(JSON.stringify(ms)),last=c[c.length-1];
  if(typeof last.content==="string")last.content=[{type:"text",text:last.content}];
  last.content[last.content.length-1].cache_control={type:"ephemeral"};
  return c;
};

function makeSample(){
  async function run(msgs,o,wantJson){
    o=o||{};
    const cfg=T.cfg,tools=o.tools||[];
    const apiTools=tools.map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema}));
    const byName={};tools.forEach(t=>{byName[t.name]=t});
    // 先頭（指示文）はキャッシュさせる。2通目以降は文字列のまま渡す
    const messages=msgs.map((m,i)=>({role:m.role,content:i===0?[{type:"text",text:m.content,cache_control:{type:"ephemeral"}}]:m.content}));
    const st=s=>{try{T.status&&T.status(s)}catch(_){}};
    let acc="",lastText="",rounds=0,calls=0,truncated=false,modelSeen="",limitHit=false;
    const use={in:0,out:0,cr:0,cw:0},t0=performance.now();
    const snap=()=>{sample.lastRun={rounds,calls,truncated,limitHit,usage:{...use},tokens:use.in+use.out+use.cr+use.cw,ms:performance.now()-t0}};
    snap();
    try{
      for(let r=0;;r++){
        if(o.signal&&o.signal.aborted)throw {code:"cancelled",text:acc};
        const final=r>=cfg.maxRounds;
        st(r===0?"考えています…":final?"回答を書いています…":"次に調べる点を考えています…");
        const body={model:o.model,max_tokens:cfg.maxTokens,messages:withCache(messages)};
        if(apiTools.length){body.tools=apiTools;if(final)body.tool_choice={type:"none"}}
        let res;
        try{res=await gasPost({action:"claude",body},o.signal)}catch(e){if(e&&e.code==="cancelled")e.text=acc;throw e}
        if(!res||!res.ok)throw {...apiErr(res||{}),text:acc};
        const d=res.data||{},u=d.usage||{};
        use.in+=u.input_tokens||0;use.out+=u.output_tokens||0;use.cr+=u.cache_read_input_tokens||0;use.cw+=u.cache_creation_input_tokens||0;
        modelSeen=d.model||modelSeen;
        const content=Array.isArray(d.content)?d.content:[];
        const text=content.filter(b=>b.type==="text").map(b=>b.text).join("").trim();
        const uses=content.filter(b=>b.type==="tool_use");
        lastText=text;
        if(text)acc+=(acc?"\n\n":"")+text;
        if(!wantJson&&o.onText)o.onText({text:acc});
        if(d.stop_reason==="refusal")throw {code:"refused",text:acc};
        if(!uses.length||final){truncated=d.stop_reason==="max_tokens";limitHit=final&&rounds>=cfg.maxRounds;break}
        messages.push({role:"assistant",content});
        rounds++;snap();
        const results=[];
        for(const tu of uses){
          if(o.signal&&o.signal.aborted)throw {code:"cancelled",text:acc};
          calls++;
          const t=byName[tu.name];let out,err=false;
          try{if(!t)throw new Error("そのツールはありません");out=await t.execute(tu.input||{})}catch(e){err=true;out="エラー："+String((e&&e.message)||e)}
          results.push({type:"tool_result",tool_use_id:tu.id,content:typeof out==="string"?out:JSON.stringify(out),...(err?{is_error:true}:{})});
        }
        messages.push({role:"user",content:results});
        snap();
      }
    }finally{snap()}
    if(!acc.trim()&&!wantJson)throw {code:"empty_completion"};
    const ok=modelSeen&&o.model&&modelSeen.startsWith(o.model);
    return {text:acc,lastText,truncated,modelApplied:ok?o.model:modelSeen,modelTierApplied:"default",rounds,calls};
  }
  const sample=async(msgs,o)=>run(msgs,o,false);
  sample.json=async(msgs,o)=>{
    const r=await run(msgs,o,true);
    const v=parseJSON(r.lastText)||parseJSON(r.text);
    if(v==null)throw {code:"invalid_json",text:r.text};
    return v;
  };
  sample.lastRun=null;
  return sample;
}

/* ---------- 記録と評価欄 ---------- */
function addBar(after,idp){
  if(after.id)document.querySelectorAll('.trate[data-for="'+after.id+'"]').forEach(x=>x.remove());
  const d=document.createElement("div");d.className="trate";if(after.id)d.dataset.for=after.id;
  d.innerHTML='<div>この回答は　<button type="button" data-r="役に立った">役に立った</button><button type="button" data-r="誤りがある">誤りがある</button> <span class="tstat"></span></div><details><summary>正しい答えを書く（わかれば）</summary><textarea rows="3" placeholder="正しい答え、または、どこがどう違うか"></textarea><button type="button" class="tsend">この内容を送る</button></details>';
  after.after(d);
  let rating="";const stat=d.querySelector(".tstat"),ta=d.querySelector("textarea");
  const send=async()=>{
    stat.textContent="送っています…";
    const id=await idp;
    if(!id){stat.textContent="記録が見つからず、送れませんでした。";return}
    try{const j=await gasPost({action:"rate",id,rating,correct:ta.value.trim()});stat.textContent=j&&j.ok?"送りました。ありがとうございます。":"送れませんでした。もう一度押してください。"}
    catch(e){stat.textContent="送れませんでした。もう一度押してください。"}
  };
  d.querySelectorAll("button[data-r]").forEach(b=>b.addEventListener("click",()=>{
    rating=b.dataset.r;
    d.querySelectorAll("button[data-r]").forEach(x=>{x.classList.toggle("on",x===b);x.classList.toggle("bad",x===b&&rating==="誤りがある")});
    if(rating==="誤りがある")d.querySelector("details").open=true;
    send();
  }));
  d.querySelector(".tsend").addEventListener("click",send);
}
T.record=function(x){
  const run=x.run||{},u=run.usage;
  const cut=x.error?(x.error==="cancelled"?"中止":"エラー："+x.error):run.limitHit?"調べる回数の上限で打ち切り":run.truncated?"文字数の上限で打ち切り":"なし";
  const rec={
    tab:x.tab||"",q:x.q||"",cond:x.cond||"",answer:x.answer||"",
    cites:(x.cites||[]).map(c=>(c.law||"")+" "+(c.label||"")+(c.doc?"（"+c.doc+"）":"")+" ["+c.ref+"]").join("\n"),
    rounds:run.rounds||0,cut,secs:Math.round((x.ms||0)/100)/10,tokens:run.tokens||0,
    model:(x.model||"")+(u?"（入力 "+u.in+"・キャッシュ読 "+u.cr+"・キャッシュ書 "+u.cw+"・出力 "+u.out+"）":"")
  };
  const idp=gasPost({action:"log",rec}).then(j=>j&&j.ok?j.id:null).catch(()=>null);
  if(x.after&&!x.error)addBar(x.after,idp);
  return idp;
};

function decorate(){
  document.title="例規ナビ（試行版）";
  const css=document.createElement("style");
  css.textContent=".tbanner{margin:8px 12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--accent-soft);font-size:12px;line-height:1.6;color:var(--fg)}"+
    ".trate{margin:10px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font-size:13px;color:var(--fg)}"+
    ".trate button{font:inherit;padding:5px 12px;margin:4px 6px 4px 0;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--fg);cursor:pointer}"+
    ".trate button.on{background:var(--ok);color:#fff;border-color:var(--ok)}.trate button.on.bad{background:var(--accent);border-color:var(--accent)}"+
    ".trate textarea{display:block;width:100%;box-sizing:border-box;font:inherit;margin-top:6px;border:1px solid var(--line);border-radius:6px;padding:6px;background:var(--bg);color:var(--fg)}"+
    ".trate summary{cursor:pointer;color:var(--muted);margin-top:4px}.trate .tstat{font-size:12px;color:var(--muted)}";
  document.head.append(css);
  const b=document.createElement("div");b.className="tbanner";
  b.textContent="試行版です。質問・回答・根拠・評価は記録され、改良に使います。事業所名・個人名は書かないでください。回答の下の「役に立った／誤りがある」を押してもらえると助かります。";
  const h=document.querySelector("header.top");if(h)h.after(b);else document.body.prepend(b);
  const n=document.getElementById("asknote");
  if(n)n.textContent=n.textContent.replace("質問すると、あなた自身のClaudeの利用枠を使います。","");
}

T.ready=function(){
  if(T._p)return T._p;
  T._p=(async()=>{
    try{
      if(location.protocol==="file:")return false;
      const r=await fetch("config.json",{cache:"no-store"});
      if(!r.ok)return false;
      const c=await r.json();
      if(!c||typeof c.api!=="string"||!/^https?:\/\//.test(c.api))return false;
      T.cfg=Object.assign({maxRounds:6,maxTokens:12000},c);
      T.sample=makeSample();T.on=true;decorate();
      return true;
    }catch(e){return false}
  })();
  return T._p;
};
})();
