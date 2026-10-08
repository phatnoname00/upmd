var nxCss=document.createElement('style');
nxCss.textContent=`
#tb .nx{font-size:.82rem; font-weight:600}
span.nt{background:rgba(255,226,60,.5); border-bottom:2px dotted #c9a300; color:inherit; cursor:pointer; border-radius:2px}
span.nt::after{content:"\\1F4DD"; font-size:.7em; margin-left:.15em; vertical-align:super}
#sn{position:fixed; z-index:35; width:min(17rem,calc(100vw - 1rem)); padding:.8rem .8rem .6rem; background:#fff176; color:#3b3200;
  border-radius:2px 2px 16px 2px; transform:rotate(-1.2deg); font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
  box-shadow:0 12px 28px rgba(0,0,0,.35), inset 0 -16px 22px -18px rgba(0,0,0,.25)}
#sn[hidden]{display:none}
#sn::before{content:""; position:absolute; left:50%; top:-9px; width:3.4rem; height:1.1rem; margin-left:-1.7rem; background:rgba(255,255,255,.55);
  border:1px solid rgba(0,0,0,.08); transform:rotate(2deg)}
#sn .snq{font-size:.76rem; opacity:.7; border-left:3px solid rgba(0,0,0,.28); padding-left:.5rem; margin-bottom:.5rem; max-height:3.4em; overflow:hidden}
#sn textarea{display:block; width:100%; min-height:6rem; resize:vertical; border:0; outline:none; color:inherit; padding:0;
  font:1rem/1.5rem "Segoe Print","Bradley Hand","Comic Sans MS",system-ui,sans-serif;
  background:repeating-linear-gradient(transparent,transparent 1.42rem,rgba(0,0,0,.14) 1.5rem)}
#sn .snb{display:flex; gap:.4rem; align-items:center; margin-top:.5rem}
#sn .sp{flex:1}
#sn button{background:rgba(255,255,255,.55); color:#3b3200; border:1px solid rgba(0,0,0,.22); padding:.28rem .7rem; font-size:.85rem}
#sn button.primary{background:#3b3200; color:#fff176; border-color:#3b3200}
#sn button.snd{color:#9a1b10}
#tts{position:fixed; left:50%; transform:translateX(-50%); bottom:calc(env(safe-area-inset-bottom,0px) + .8rem); z-index:55;
  width:min(36rem,calc(100vw - 1rem)); display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; padding:.55rem .6rem;
  background:var(--panel); border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 28px rgba(0,0,0,.3);
  font:.88rem system-ui,-apple-system,"Segoe UI",sans-serif}
#tts[hidden]{display:none}
#tts button{padding:.35rem .65rem}
#tts select{font:inherit; font-size:.84rem; padding:.3rem .4rem; border:1px solid var(--line); border-radius:6px; background:var(--bg1); color:var(--ink); min-width:0}
#ttVoice{flex:1 1 9rem}
body.tts-on #toast{bottom:calc(env(safe-area-inset-bottom,0px) + 7.5rem)}
body.tts-on main{padding-bottom:9rem}
#doc .speaking{background:rgba(255,206,60,.25); box-shadow:0 0 0 4px rgba(255,206,60,.25); border-radius:4px}
@media print{#sn,#tts,#ttsBtn{display:none}}
`;
document.head.appendChild(nxCss);

/* ---------- HTML: tờ giấy note, thanh đọc, nút "Đọc" ---------- */
var snEl=document.createElement('div');
snEl.id='sn'; snEl.hidden=true; snEl.setAttribute('role','dialog'); snEl.setAttribute('aria-label','Ghi chú');
snEl.innerHTML='<div class="snq" id="snq"></div><textarea id="snt" rows="4" placeholder="Viết ghi chú ở đây…" aria-label="Nội dung ghi chú"></textarea>'
  +'<div class="snb"><button id="snDel" class="snd">Xóa</button><span class="sp"></span><button id="snOk" class="primary">Lưu</button></div>';
document.body.appendChild(snEl);

var ttsEl=document.createElement('div');
ttsEl.id='tts'; ttsEl.hidden=true; ttsEl.setAttribute('role','region'); ttsEl.setAttribute('aria-label','Trình đọc thành tiếng');
ttsEl.innerHTML='<button id="ttPrev">Trước</button><button id="ttPlay" class="primary">Tạm dừng</button><button id="ttNext">Sau</button><button id="ttStop">Dừng</button>'
  +'<select id="ttRate" aria-label="Tốc độ đọc"><option value="0.75">0,75×</option><option value="1">1×</option><option value="1.25">1,25×</option>'
  +'<option value="1.5">1,5×</option><option value="1.75">1,75×</option><option value="2">2×</option></select>'
  +'<select id="ttVoice" aria-label="Giọng đọc"></select>';
document.body.appendChild(ttsEl);

var ttsBtn=document.createElement('button');
ttsBtn.id='ttsBtn'; ttsBtn.textContent='Đọc'; ttsBtn.hidden=true; ttsBtn.setAttribute('aria-pressed','false');
$('vpBtn').parentNode.insertBefore(ttsBtn,$('vpBtn'));

/* ---------- GHI CHÚ ---------- */
var snId=null,snNew=false;

function openNote(id,rect,isNew){
  if(snId&&snId!==id){
    closeNote(true);
    var again=doc.querySelector('[data-id="'+id+'"]'); if(again)rect=again.getBoundingClientRect(); // closeNote có thể vẽ lại tài liệu
  }
  var a=cur&&cur.anns.find(function(x){return x.id===id}); if(!a)return;
  snId=id; snNew=!!isNew;
  var q=Array.prototype.map.call(doc.querySelectorAll('[data-id="'+id+'"]'),function(e){return e.textContent}).join('').trim();
  $('snq').textContent=q.length>90?q.slice(0,90)+'…':q;
  $('snt').value=a.txt||'';
  snEl.hidden=false;
  var w=snEl.offsetWidth,h=snEl.offsetHeight,top=rect.bottom+12;
  if(top+h>innerHeight-8)top=Math.max(8,rect.top-h-12);
  snEl.style.top=top+'px';
  snEl.style.left=Math.max(8,Math.min(innerWidth-w-8,rect.left))+'px';
  $('snt').focus();
}

/* keep=true: lưu (nội dung trống = xóa ghi chú). keep=false: bỏ các sửa đổi chưa lưu. */
function closeNote(keep){
  var id=snId; snId=null; snEl.hidden=true;
  if(!id||!cur)return;
  var a=cur.anns.find(function(x){return x.id===id}); if(!a)return;
  var txt=$('snt').value.trim();
  if(keep&&txt){
    a.txt=txt;
    doc.querySelectorAll('[data-id="'+id+'"]').forEach(function(el){el.title=txt});
    save();
  }else if(keep||snNew){
    cur.anns=cur.anns.filter(function(x){return x.id!==id});
    paint(); save();
  }
}

$('snOk').addEventListener('click',function(){closeNote(true)});
$('snDel').addEventListener('click',function(){$('snt').value='';closeNote(true)});
snEl.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();closeNote(true)}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!snEl.hidden)closeNote(true)});

/* Bấm vào chữ có ghi chú -> mở tờ giấy (chặn thanh "Xóa chú thích" mặc định) */
doc.addEventListener('click',function(e){
  var el=e.target.closest&&e.target.closest('span.nt');
  if(!el||!getSelection().isCollapsed)return;
  e.stopPropagation(); hideTb();
  openNote(el.dataset.id,el.getBoundingClientRect(),false);
},true);
/* Bấm ra ngoài -> tự lưu và đóng */
document.addEventListener('click',function(e){
  if(snEl.hidden||snEl.contains(e.target)||tb.contains(e.target))return;
  if(e.target.closest&&e.target.closest('span.nt'))return;
  closeNote(true);
});

/* Móc vào các hàm có sẵn */
var _wrap=wrap;
wrap=function(a){
  _wrap(a);
  if(a.t==='nt')doc.querySelectorAll('[data-id="'+a.id+'"]').forEach(function(el){el.className='a nt'; if(a.txt)el.title=a.txt});
};

var _showTb=showTb;
showTb=function(rect,mode){
  _showTb(rect,mode);
  if(mode!=='add')return;
  function mk(txt,label,fn){
    var x=document.createElement('button'); x.className='nx'; x.textContent=txt; x.title=label; x.setAttribute('aria-label',label);
    x.addEventListener('mousedown',function(e){e.preventDefault()}); x.addEventListener('click',fn); tb.appendChild(x);
  }
  mk('Ghi chú','Thêm ghi chú dạng giấy note',function(){addAnn('nt')});
  mk('Đọc','Đọc từ đoạn này',ttsFromSel);
  var w=tb.offsetWidth;
  tb.style.left=Math.max(8,Math.min(innerWidth-w-8,rect.left+rect.width/2-w/2))+'px';
};

var _addAnn=addAnn;
addAnn=function(t,c){
  if(t!=='nt')return _addAnn(t,c);
  if(!pend||!cur)return;
  var id='n'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  cur.anns.push({id:id,s:pend.s,e:pend.e,t:'nt',txt:''});
  getSelection().removeAllRanges(); hideTb(); paint(); save();
  var el=doc.querySelector('[data-id="'+id+'"]');
  if(el)openNote(id,el.getBoundingClientRect(),true);
  else{cur.anns=cur.anns.filter(function(x){return x.id!==id}); save()} // vùng chọn chỉ có khoảng trắng
};

var _open=open;
open=function(rec){closeNote(true); ttsStop(); _open(rec)};

var _setMode=setMode;
setMode=function(s){_setMode(s); ttsBtn.hidden=s; if(s)ttsStop(); closeNote(true)};

/* ---------- ĐỌC THÀNH TIẾNG (Web Speech API) ---------- */
var ttsGen=0,ttsIdx=0,ttsPaused=false,ttsU=null;
var ttsVI=/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
function ttsSupported(){return 'speechSynthesis' in window&&'SpeechSynthesisUtterance' in window}

/* Các khối được đọc theo thứ tự: tiêu đề, đoạn, mục danh sách, trích dẫn, dòng bảng. Bỏ qua code. */
function ttsBlocks(){
  var out=[];
  doc.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,tr').forEach(function(el){
    if(el.closest('pre,.cbh'))return;
    if(el.tagName==='BLOCKQUOTE'&&el.querySelector('p,li'))return;
    if(el.tagName==='LI'&&el.querySelector(':scope > p'))return;
    out.push(el);
  });
  return out;
}
function ttsText(el){
  var c=el.cloneNode(true);
  c.querySelectorAll('ul,ol,pre,.cbh,input').forEach(function(x){x.remove()});
  var t=c.tagName==='TR'
    ?Array.prototype.map.call(c.children,function(x){return x.textContent.trim()}).join(', ')
    :c.textContent;
  return t.replace(/\s+/g,' ').trim();
}
/* Cắt câu dài thành đoạn <= ~180 ký tự để trình duyệt không bị ngắt giữa chừng */
function ttsChunk(t){
  var parts=t.replace(/([.!?…;:])\s+/g,'$1\u0001').split('\u0001'),out=[],buf='';
  parts.forEach(function(x){
    while(x.length>200){
      var j=x.lastIndexOf(' ',200); if(j<50)j=200;
      if(buf){out.push(buf);buf=''}
      out.push(x.slice(0,j)); x=x.slice(j).trim();
    }
    if(buf&&(buf+' '+x).length>180){out.push(buf);buf=x}else buf=buf?buf+' '+x:x;
  });
  if(buf)out.push(buf);
  return out.map(function(s){return s.trim()}).filter(Boolean);
}
function ttsMark(el){
  doc.querySelectorAll('.speaking').forEach(function(x){x.classList.remove('speaking')});
  if(el)el.classList.add('speaking');
}
function ttsVisIdx(){
  var bl=ttsBlocks();
  for(var i=0;i<bl.length;i++){if(bl[i].getBoundingClientRect().bottom>110)return i}
  return 0;
}
function ttsVoiceFor(text){
  var vs=speechSynthesis.getVoices(),pick=$('ttVoice').value,i;
  if(pick){for(i=0;i<vs.length;i++)if(vs[i].voiceURI===pick)return vs[i]}
  var want=ttsVI.test(text)?'vi':'en';
  for(i=0;i<vs.length;i++)if(vs[i].lang.toLowerCase().indexOf(want)===0)return vs[i];
  return null;
}
function ttsHalt(){try{speechSynthesis.resume();speechSynthesis.cancel()}catch(e){}}
function ttsSetPlay(){$('ttPlay').textContent=ttsPaused?'Tiếp tục':'Tạm dừng'}

function ttsRead(i,g){
  if(g!==ttsGen)return;
  var bl=ttsBlocks();
  if(i>=bl.length){ttsStop();toast('Đã đọc xong');return}
  var t=ttsText(bl[i]);
  if(!t){ttsRead(i+1,g);return}
  ttsIdx=i; ttsMark(bl[i]);
  var r=bl[i].getBoundingClientRect();
  if(r.top<90||r.bottom>innerHeight-140)bl[i].scrollIntoView({block:'center',behavior:'smooth'});
  var parts=ttsChunk(t),k=0,rate=+$('ttRate').value||1;
  (function next(){
    if(g!==ttsGen)return;
    if(k>=parts.length){ttsRead(i+1,g);return}
    var txt=parts[k++],u=new SpeechSynthesisUtterance(txt),v=ttsVoiceFor(txt);
    if(v){u.voice=v;u.lang=v.lang}else u.lang=ttsVI.test(txt)?'vi-VN':'en-US';
    u.rate=rate;
    u.onend=next;
    u.onerror=function(e){
      if(g!==ttsGen)return;
      var er=e&&e.error;
      if(er==='interrupted'||er==='canceled')return;
      if(er==='not-allowed'){ttsStop();toast('Trình duyệt chặn việc đọc, hãy bấm nút "Đọc" lại');return}
      next();
    };
    ttsU=u; // giữ tham chiếu để trình duyệt không thu gom giữa chừng
    speechSynthesis.speak(u);
  })();
}

function ttsStart(i){
  if(!ttsSupported()){toast('Trình duyệt này không hỗ trợ đọc thành tiếng');return}
  if(!cur||showSource){toast('Hãy mở một tệp để đọc');return}
  if(i==null||i<0)i=ttsVisIdx();
  ttsHalt(); ttsGen++; ttsPaused=false; ttsSetPlay();
  ttsEl.hidden=false; document.body.classList.add('tts-on'); ttsBtn.setAttribute('aria-pressed','true');
  var g=ttsGen;
  setTimeout(function(){ttsRead(i,g)},60); // chờ một nhịp sau cancel() để giọng đọc không bị nuốt câu đầu
}
function ttsStop(){
  ttsGen++;
  if(ttsSupported())ttsHalt();
  ttsMark(null); ttsPaused=false;
  ttsEl.hidden=true; document.body.classList.remove('tts-on'); ttsBtn.setAttribute('aria-pressed','false');
}
function ttsFromSel(){
  var sel=getSelection(),i=-1;
  if(sel.rangeCount){
    var n=sel.getRangeAt(0).startContainer; n=n.nodeType===3?n.parentNode:n;
    ttsBlocks().forEach(function(b,k){if(b.contains(n))i=k}); // khối sâu nhất chứa vùng chọn
  }
  sel.removeAllRanges(); hideTb(); ttsStart(i);
}
function ttsFill(){
  var sel=$('ttVoice'),keep=sel.value||lsGet('md-tts-voice')||'';
  var vs=speechSynthesis.getVoices().slice().sort(function(a,b){
    var x=/^vi/i.test(a.lang)?0:1,y=/^vi/i.test(b.lang)?0:1; return x-y||a.name.localeCompare(b.name)});
  sel.innerHTML='<option value="">Giọng: tự động</option>';
  vs.forEach(function(v){var o=document.createElement('option');o.value=v.voiceURI;o.textContent=v.name+' ('+v.lang+')';sel.appendChild(o)});
  sel.value=keep; if(sel.value!==keep)sel.value='';
}

ttsBtn.addEventListener('click',function(){if(!ttsEl.hidden)ttsStop();else ttsStart(-1)});
$('ttStop').addEventListener('click',ttsStop);
$('ttPrev').addEventListener('click',function(){ttsStart(Math.max(0,ttsIdx-1))});
$('ttNext').addEventListener('click',function(){ttsStart(ttsIdx+1)});
$('ttPlay').addEventListener('click',function(){
  if(ttsPaused){speechSynthesis.resume();ttsPaused=false}
  else if(speechSynthesis.speaking){speechSynthesis.pause();ttsPaused=true}
  else ttsStart(ttsIdx);
  ttsSetPlay();
});
$('ttRate').value=lsGet('md-tts-rate')||'1';
$('ttRate').addEventListener('change',function(){lsSet('md-tts-rate',this.value); if(!ttsEl.hidden)ttsStart(ttsIdx)});
$('ttVoice').addEventListener('change',function(){lsSet('md-tts-voice',this.value); if(!ttsEl.hidden)ttsStart(ttsIdx)});
if(ttsSupported()){
  ttsFill();
  if(speechSynthesis.addEventListener)speechSynthesis.addEventListener('voiceschanged',ttsFill);
  else speechSynthesis.onvoiceschanged=ttsFill;
}
