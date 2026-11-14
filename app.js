/* =====================================================================
   app.js – Trình xem Markdown (upmd)
   Toàn bộ logic: thư viện, chú thích, ghi chú giấy note, danh sách chú thích,
   đọc thành tiếng, nền sao, tùy chỉnh hiển thị, sao lưu/khôi phục.
   Cần nạp SAU marked.min.js và purify.min.js (xem cuối index.html).
   ===================================================================== */
(function(){
  var $=function(id){return document.getElementById(id)};
  var drop=$('drop'),doc=$('doc'),src=$('src'),view=$('view'),paste=$('paste'),tb=$('tb'),list=$('list');
  var snEl=$('sn'),ttsEl=$('tts'),ttsBtn=$('ttsBtn'),stT=$('stT'),vp=$('vp');
  var showSource=false,cur=null,baseHTML='',pend=null,editId=null,records=[],notes=[];
  var plain='',headOffs=[],snId=null,snNew=false,annFilter='';
  var ttsGen=0,ttsIdx=0,ttsPaused=false,ttsU=null;
  var COLORS=[['y','Vàng','#ffce3c'],['g','Xanh lá','#58c878'],['b','Xanh dương','#5aa0ff'],['p','Hồng','#ff78aa']];
  var coarse=matchMedia('(pointer: coarse)').matches;

  function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}

  /* ---------- IndexedDB (v2: thêm kho "prefs" cho ảnh nền) ---------- */
  var dbp=new Promise(function(res,rej){
    try{var q=indexedDB.open('mdviewer',2);
      q.onupgradeneeded=function(){var d=q.result;
        if(!d.objectStoreNames.contains('files'))d.createObjectStore('files',{keyPath:'id'});
        if(!d.objectStoreNames.contains('prefs'))d.createObjectStore('prefs')};
      q.onsuccess=function(){res(q.result)};q.onerror=function(){rej(q.error)};
    }catch(e){rej(e)}
  });
  function tx(mode,fn,st){st=st||'files';return dbp.then(function(db){return new Promise(function(res,rej){
    var t=db.transaction(st,mode),r=fn(t.objectStore(st));
    t.oncomplete=function(){res(r&&r.result)};t.onerror=function(){rej(t.error)};
  })})}
  function save(){if(!cur)return;
    if(records.indexOf(cur)<0)records.unshift(cur);
    tx('readwrite',function(s){return s.put(cur)}).catch(function(){}); drawList();}
  function loadAll(){return tx('readonly',function(s){return s.getAll()}).then(function(a){
    records=(a||[]).sort(function(x,y){return y.opened-x.opened});drawList();}).catch(function(){})}

  /* ---------- Thông báo, băm nội dung, tải tệp, sao chép ---------- */
  var toastT;
  function toast(m){var t=$('toast');t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},4500)}
  function norm(s){return s.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')}
  function hash(s){ // cyrb53 + độ dài: nhanh, đủ chính xác cho tệp văn bản
    var h1=0xdeadbeef,h2=0x41c6ce57,i,c;
    for(i=0;i<s.length;i++){c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}
    h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
    return (h2>>>0).toString(16)+(h1>>>0).toString(16)+'.'+s.length;
  }
  function hOf(r){return r.h||(r.h=hash(norm(r.text)))}
  function uniqueName(n){
    var m=/^(.*?)(\.[^.]*)?$/.exec(n),b=m[1],e=m[2]||'',i=2;
    while(records.some(function(x){return x.name===b+' ('+i+')'+e}))i++;
    return b+' ('+i+')'+e;
  }
  function stamp(){var d=new Date(),p=function(n){return String(n).padStart(2,'0')};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())}
  function downloadText(name,data,mime,okMsg){
    function ok(){toast(okMsg)}
    function fb(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:mime}));
      a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000);ok()}
    var pr;try{pr=window.claude&&claude.use?claude.use('downloads'):null}catch(e){pr=null}
    if(!pr||!pr.then)return fb();
    pr.then(function(d){
      if(!d)return fb();
      return d.save({filename:name,data:data}).then(ok,function(e){if(!e||e.code!=='declined')toast('Không lưu được tệp "'+name+'"')});
    },fb);
  }
  function copyText(t,btn){
    function ok(){if(btn){btn.classList.add('ok');setTimeout(function(){btn.classList.remove('ok')},1500)}}
    function fb(){var a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;top:0;opacity:0';
      document.body.appendChild(a);a.select();try{document.execCommand('copy');ok()}catch(e){}a.remove()}
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(ok,fb);else fb();
  }

  /* ---------- Mở / đóng tài liệu ---------- */
  function readMins(t){return Math.max(1,Math.round(t.split(/\s+/).length/200))}
  function open(rec){
    closeNote(true); ttsStop();
    cur=rec; rec.opened=Date.now(); reatt=null;
    baseHTML=render(rec.text);
    var up=upgrade(rec,plainOf(baseHTML)),announce=rec.announce; delete rec.announce;
    src.textContent=rec.text;
    $('findBtn').hidden=false; $('exBtn').hidden=false;
    $('name').textContent=rec.name+' · ~'+readMins(rec.text)+' phút đọc'; $('name').title=rec.name;
    document.title=rec.name+' – Trình xem Markdown';
    drop.style.display='none'; view.hidden=false; setMode(false);
    paint(); hideTb(); closeLib(); restorePos(rec); save();
    if(up&&up.total&&(announce||up.lostNew||up.back)){
      var m=announce?'Đã gắn lại '+up.kept+'/'+up.total+' chú thích theo nội dung mới':up.back?'Đã gắn lại '+up.back+' chú thích bị lạc':'';
      if(up.lost)m+=(m?'. ':'')+up.lost+' chú thích bị lạc, xem ở tab "Chú thích"';
      toast(m); return m;
    }
    return '';
  }
  function closeDoc(){
    closeNote(true); ttsStop(); hideTb(); closeFind(); setZen(false);
    cur=null; doc.innerHTML=''; src.textContent=''; plain=''; headOffs=[];
    doc.style.display=src.style.display='none';
    view.hidden=true; $('tocBtn').hidden=true; ttsBtn.hidden=true; $('prog').style.width='0';
    $('findBtn').hidden=true; $('exBtn').hidden=true; $('ex').hidden=true;
    drop.style.display=''; $('name').textContent='Chưa mở tệp nào'; $('name').title='';
    document.title='Trình xem Markdown'; closeLib(); drawAnnList();
  }
  function paint(){
    doc.innerHTML=baseHTML;
    doc.querySelectorAll('table').forEach(function(t){
      var w=document.createElement('div');w.className='scroll';t.parentNode.insertBefore(w,t);w.appendChild(t);});
    doc.querySelectorAll('a[href^="http"]').forEach(function(a){a.target='_blank';a.rel='noopener noreferrer'});
    applyAnns(cur.anns);
    if(cur.anns.some(noQ)){fillAnchors(cur,plain);tx('readwrite',function(s){return s.put(cur)}).catch(function(){})}
    addCopyBars();
    buildToc();
    drawAnnList();
    fillMath(); fillMermaid();
    if(!ttsEl.hidden)ttsMark(ttsBlocks()[ttsIdx]);
    refind();
  }

  /* Tô màu cú pháp MỘT lần khi mở tệp (không làm ở paint() để khỏi chạy lại mỗi lần thêm chú thích).
     highlight.js chỉ bọc thêm <span>, không đổi nội dung chữ nên vị trí chú thích vẫn đúng. */
  function highlightCode(html){
    if(!window.hljs)return html;
    var t=document.createElement('template');t.innerHTML=html;
    t.content.querySelectorAll('pre code').forEach(function(c){
      var m=/language-([\w+#-]+)/.exec(c.className);
      if(!m||!hljs.getLanguage(m[1])||c.textContent.length>200000)return;
      try{c.innerHTML=hljs.highlight(c.textContent,{language:m[1],ignoreIllegals:true}).value;c.classList.add('hljs')}catch(e){}
    });
    return t.innerHTML;
  }

  /* ---------- Dựng Markdown: công thức toán ($...$, $$...$$, \(...\), \[...\]) và sơ đồ mermaid ----------
     Công thức và sơ đồ nằm trong phần tử có [data-noann]: phần chữ bên trong KHÔNG được tính vào
     "toàn văn" dùng để định vị chú thích, nên việc vẽ chúng (bất đồng bộ) không làm lệch chú thích. */
  var RV=2; // phiên bản cách dựng; v1 = chưa có công thức/sơ đồ
  var md=marked.Marked?new marked.Marked():marked;
  md.use({gfm:true,breaks:false,
    extensions:[{
      name:'mathBlock',level:'block',
      start:function(s){var m=/^(\$\$|\\\[)/m.exec(s);return m?m.index:undefined},
      tokenizer:function(s){
        var m=/^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(s)||/^\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/.exec(s);
        if(m&&m[1].trim())return {type:'mathBlock',raw:m[0],text:m[1].trim()};
      },
      renderer:function(t){return '<div class="math math-d" data-noann data-d="1" data-tex="'+esc(t.text)+'">'+esc(t.text)+'</div>\n'}
    },{
      name:'mathInline',level:'inline',
      start:function(s){var m=/(^|[^\\])(\$|\\\()/.exec(s);return m?m.index+m[1].length:undefined},
      tokenizer:function(s){
        var m=/^\$\$(?!\s)([^$]+?)\$\$/.exec(s),d=!!m;
        if(!m)m=/^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/.exec(s); // "$5 và $10" không bị coi là công thức
        if(!m)m=/^\\\(([\s\S]+?)\\\)/.exec(s);
        if(m)return {type:'mathInline',raw:m[0],text:m[1],d:d};
      },
      renderer:function(t){return '<span class="math'+(t.d?' math-d':'')+'" data-noann'+(t.d?' data-d="1"':'')+' data-tex="'+esc(t.text)+'">'+esc(t.text)+'</span>'}
    }],
    renderer:{code:function(code,lang){
      if(code&&typeof code==='object'){lang=code.lang;code=code.text}
      if(String(lang||'').trim().split(/\s/)[0].toLowerCase()==='mermaid')
        return '<div class="mmd" data-noann><pre class="mmd-src">'+esc(code)+'</pre></div>\n';
      return false;
    }}
  });
  /* legacy=true: dựng như phiên bản cũ (không công thức/sơ đồ) để đọc lại vị trí chú thích cũ */
  function render(text,legacy){
    if(legacy)return DOMPurify.sanitize(marked.parse(text,{gfm:true,breaks:false}));
    return highlightCode(DOMPurify.sanitize(md.parse(text)));
  }
  function textWalker(root){
    return document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
      var p=n.parentNode;return p&&p.closest&&p.closest('[data-noann]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}});
  }
  function plainOf(html){
    var t=document.createElement('template');t.innerHTML=html;
    var w=textWalker(t.content),n,o=[];while((n=w.nextNode()))o.push(n.nodeValue);return o.join('');
  }

  /* ---------- Neo chú thích: lưu đoạn trích + ngữ cảnh để gắn lại khi nội dung đổi ---------- */
  var CTX=32;
  function anchor(a,p){a.q=p.slice(a.s,a.e);a.pre=p.slice(Math.max(0,a.s-CTX),a.s);a.suf=p.slice(a.e,a.e+CTX)}
  function noQ(a){return typeof a.q!=='string'}
  function fillAnchors(rec,p){rec.anns.forEach(function(a){if(noQ(a))anchor(a,p)});rec.plen=p.length}
  /* Bảo đảm mọi chú thích đã có neo, tính theo đúng cách dựng mà vị trí s/e đang dùng */
  function ensureAnchors(rec){
    if(rec.anns.some(noQ))fillAnchors(rec,plainOf(render(rec.text,(rec.rv||1)<RV)));
  }
  function ctxScore(p,s,e,a){
    var k=0,pre=a.pre||'',suf=a.suf||'';
    while(k<pre.length&&s-1-k>=0&&p.charAt(s-1-k)===pre.charAt(pre.length-1-k))k++;
    var j=0;while(j<suf.length&&e+j<p.length&&p.charAt(e+j)===suf.charAt(j))j++;
    return k+j;
  }
  function normMap(s){ // gộp khoảng trắng + chữ thường, kèm bảng ánh xạ về vị trí gốc
    var o=[],map=[],sp=false,i,c;
    for(i=0;i<s.length;i++){c=s.charAt(i);
      if(/\s/.test(c)){if(!sp&&o.length){o.push(' ');map.push(i)}sp=true;continue}
      sp=false;o.push(c.toLowerCase().charAt(0));map.push(i)}
    if(o[o.length-1]===' '){o.pop();map.pop()}
    return {s:o.join(''),map:map};
  }
  /* Tìm vị trí mới của chú thích trong toàn văn p. hint = vị trí dự đoán (theo tỉ lệ vị trí cũ). */
  function locate(a,p,np,hint){
    var q=a.q,best=null,bs=-1e9,i,n;
    if(!q||!q.trim())return null;
    function pick(s,e,score){if(score>bs){bs=score;best={s:s,e:e}}}
    function near(s){return 1-Math.min(1,Math.abs(s-hint)/(p.length+1))} // 0..1, càng gần càng cao
    // 1) khớp chính xác, ưu tiên ngữ cảnh rồi tới khoảng cách
    for(i=p.indexOf(q),n=0;i>=0&&n<2000;i=p.indexOf(q,i+1),n++)pick(i,i+q.length,ctxScore(p,i,i+q.length,a)+near(i));
    if(best)return best;
    // 2) bỏ qua khác biệt khoảng trắng / hoa thường
    var nq=normMap(q).s;
    if(nq.length>=3){
      for(i=np.s.indexOf(nq),n=0;i>=0&&n<2000;i=np.s.indexOf(nq,i+1),n++){
        var s=np.map[i],e=np.map[i+nq.length-1]+1;pick(s,e,ctxScore(p,s,e,a)+near(s))}
      if(best)return best;
    }
    // 3) đoạn dài bị sửa ở giữa: khớp phần đầu + phần cuối, độ dài hợp lý
    if(q.length>=12){
      var k=Math.min(24,Math.floor(q.length/3)),head=q.slice(0,k),tail=q.slice(-k);
      for(i=p.indexOf(head),n=0;i>=0&&n<500;i=p.indexOf(head,i+1),n++){
        var lim=i+Math.round(q.length*1.6)+20,j=p.indexOf(tail,i+k);
        if(j<0||j+k>lim)continue;
        var len=j+k-i;if(len<q.length*.5)continue;
        pick(i,j+k,near(i)-Math.abs(len-q.length)/q.length);
      }
      if(best)return best;
    }
    return null;
  }
  /* Gắn lại toàn bộ chú thích (kể cả những cái đang "bị lạc") vào toàn văn mới p */
  function reanchor(rec,p){
    var np=normMap(p),old=rec.plen||p.length,kept=[],lost=[],moved=0,back=0,lost0=(rec.lost||[]).length;
    function one(a,wasLost){
      var r=locate(a,p,np,a.s/old*p.length);
      if(r){if(wasLost)back++;else if(r.s!==a.s||r.e!==a.e)moved++;a.s=r.s;a.e=r.e;anchor(a,p);kept.push(a)}
      else lost.push(a);
    }
    rec.anns.forEach(function(a){one(a,false)});
    (rec.lost||[]).forEach(function(a){one(a,true)});
    rec.anns=kept;rec.lost=lost;rec.plen=p.length;
    return {total:kept.length+lost.length,kept:kept.length,moved:moved,back:back,lost:lost.length,lostNew:Math.max(0,lost.length-lost0)};
  }
  /* Đưa bản ghi về cách dựng hiện tại; trả về kết quả gắn lại (nếu có) */
  function upgrade(rec,p){
    var res=null;
    rec.anns=rec.anns||[];
    if((rec.rv||1)<RV&&rec.anns.length){
      var op=plainOf(render(rec.text,true));fillAnchors(rec,op);
      if(op!==p)rec.reanchor=true;
    }else if(rec.anns.some(noQ))fillAnchors(rec,p);
    if(rec.reanchor){res=reanchor(rec,p);delete rec.reanchor}
    rec.rv=RV;rec.plen=p.length;
    return res;
  }

  /* ---------- Vẽ công thức (KaTeX) và sơ đồ (Mermaid): chỉ tải thư viện khi tài liệu cần ---------- */
  var KJS='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',KCSS='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  var MJS='https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
  var libs={},mathCache=new Map(),mmdCache=new Map(),mmdN=0,mmdQ=Promise.resolve(),mmdTheme=null;
  function loadScript(u){
    if(!libs[u])libs[u]=new Promise(function(res,rej){var s=document.createElement('script');s.src=u;s.async=true;
      s.onload=res;s.onerror=function(){delete libs[u];s.remove();rej()};document.head.appendChild(s)});
    return libs[u];
  }
  function loadCss(u){if(document.querySelector('link[href="'+u+'"]'))return;var l=document.createElement('link');l.rel='stylesheet';l.href=u;document.head.appendChild(l)}
  function fillMath(){
    var els=doc.querySelectorAll('.math');if(!els.length)return;
    if(!window.katex){loadCss(KCSS);loadScript(KJS).then(function(){if(cur)fillMath()},function(){toast('Không tải được thư viện công thức toán, hãy kiểm tra mạng')});return}
    els.forEach(function(el){
      var d=el.dataset.d==='1',tex=el.dataset.tex||'',k=(d?'D':'I')+tex,h=mathCache.get(k);
      if(h==null){try{h=katex.renderToString(tex,{displayMode:d,throwOnError:false,output:'htmlAndMathml'})}catch(e){h=''}mathCache.set(k,h)}
      if(h){el.innerHTML=h;el.title=tex}
    });
  }
  function isDark(){var t=document.documentElement.getAttribute('data-theme');return t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches}
  function mmdShow(el,v){
    if(!el.isConnected)return;
    if(typeof v==='string'){el.innerHTML=v;return}
    el.innerHTML='';var er=document.createElement('div'),pre=document.createElement('pre');
    er.className='mmd-err';er.textContent='Không vẽ được sơ đồ: '+v.err;pre.className='mmd-src';pre.textContent=el._src;
    el.appendChild(er);el.appendChild(pre);
  }
  function fillMermaid(){
    var els=doc.querySelectorAll('.mmd');if(!els.length)return;
    if(!window.mermaid){loadScript(MJS).then(function(){if(cur)fillMermaid()},function(){toast('Không tải được thư viện sơ đồ, hãy kiểm tra mạng')});return}
    var th=isDark()?'dark':'default';
    els.forEach(function(el){
      if(el._src==null){var s=el.querySelector('.mmd-src');el._src=s?s.textContent:''}
      var k=th+'\n'+el._src,v=mmdCache.get(k);
      if(v!=null){mmdShow(el,v);return}
      mmdQ=mmdQ.then(function(){ // vẽ lần lượt từng sơ đồ
        if(mmdCache.has(k)){mmdShow(el,mmdCache.get(k));return}
        if(mmdTheme!==th){mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:th,fontFamily:'system-ui,-apple-system,"Segoe UI",sans-serif'});mmdTheme=th}
        var id='mmd'+(++mmdN);
        return mermaid.render(id,el._src).then(function(r){mmdCache.set(k,r.svg);mmdShow(el,r.svg)},function(e){
          var x={err:String(e&&e.message||e).split('\n')[0]};mmdCache.set(k,x);mmdShow(el,x);
          var junk=document.getElementById('d'+id);if(junk)junk.remove();
        });
      });
    });
  }

  /* Tô toàn bộ chú thích trong MỘT lần duyệt văn bản:
     1) cắt các nút chữ tại mọi điểm đầu/cuối chú thích,
     2) bọc các đoạn nằm trong mỗi chú thích.
     Đồng thời ghi lại toàn văn (plain) và vị trí các tiêu đề để dựng danh sách chú thích. */
  function applyAnns(anns){
    var w=textWalker(doc),n,nodes=[],parts=[],segs=[],pos=0,ci=0,lastH=null;
    var cuts=[];anns.forEach(function(a){cuts.push(a.s,a.e)});cuts.sort(function(x,y){return x-y});
    while((n=w.nextNode()))nodes.push(n);
    headOffs=[];
    nodes.forEach(function(n){
      var v=n.nodeValue,l=v.length,st=pos;parts.push(v);pos+=l;
      if(!l)return;
      var hh=n.parentNode.closest&&n.parentNode.closest('h1,h2,h3,h4');
      if(hh&&hh!==lastH){lastH=hh;headOffs.push({el:hh,off:st})}
      while(ci<cuts.length&&cuts[ci]<=st)ci++;
      var node=n,base=st,k=ci;
      while(k<cuts.length&&cuts[k]<st+l){
        if(cuts[k]>base){var rest=node.splitText(cuts[k]-base);segs.push({n:node,s:base,e:cuts[k]});node=rest;base=cuts[k]}
        k++;
      }
      segs.push({n:node,s:base,e:st+l});
    });
    plain=parts.join('');
    anns.forEach(function(a){
      var lo=0,hi=segs.length,made=[];
      while(lo<hi){var m=(lo+hi)>>1;if(segs[m].e<=a.s)lo=m+1;else hi=m}
      for(var i=lo;i<segs.length&&segs[i].s<a.e;i++){
        var sg=segs[i];if(!sg.n.nodeValue.trim())continue;
        var el=document.createElement(a.t==='hl'?'mark':'span');
        el.className='a '+a.t+(a.txt?' hn':''); el.dataset.id=a.id;
        if(a.t==='hl')el.dataset.c=a.c||'y';
        if(a.txt)el.title=a.txt;
        sg.n.parentNode.insertBefore(el,sg.n); el.appendChild(sg.n); made.push(el);
      }
      if(made.length)made[made.length-1].classList.add('last');
    });
  }
  function annText(a){return plain.slice(a.s,a.e).replace(/\s+/g,' ').trim()}
  function annHead(a){var h='';for(var i=0;i<headOffs.length&&headOffs[i].off<=a.s;i++)h=headOffs[i].el.textContent.trim();return h}
  function colorOf(c){for(var i=0;i<COLORS.length;i++)if(COLORS[i][0]===c)return COLORS[i];return COLORS[0]}
  function annColor(a){return a.t==='hl'?colorOf(a.c)[2]:a.t==='ul'?'var(--accent)':'#e6c200'}
  function annLabel(a){return a.t==='hl'?'Highlight '+colorOf(a.c)[1].toLowerCase():a.t==='ul'?'Gạch chân':'Ghi chú'}

  /* ---------- Sao chép code / bảng ---------- */
  var IC_CP='<svg class="cp" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><svg class="ck" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
  var IC_WP='<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4m0 0l2-2m-2 2l2 2M4 18h5"/></svg>';
  function mkBtn(icon,label,fn){var b=document.createElement('button');b.innerHTML=icon;b.setAttribute('aria-label',label);b.title=label;b.addEventListener('click',fn);return b}
  function decorate(el,label,getText,canWrap){
    var box=document.createElement('div'),h=document.createElement('div'),acts=document.createElement('div');
    box.className='cb';h.className='cbh';h.dataset.l=label;acts.className='acts';
    if(canWrap){var w=mkBtn(IC_WP,'Xuống dòng',function(){var on=el.classList.toggle('wrap');w.setAttribute('aria-pressed',String(on))});
      w.setAttribute('aria-pressed','false');acts.appendChild(w)}
    var c=mkBtn(IC_CP,'Sao chép',function(){copyText(getText(),c)});acts.appendChild(c);
    h.appendChild(acts);el.parentNode.insertBefore(box,el);box.appendChild(h);box.appendChild(el);
  }
  function addCopyBars(){
    doc.querySelectorAll('pre').forEach(function(p){
      if(p.closest('.mmd'))return;
      var c=p.querySelector('code'),m=c&&/language-([\w+#-]+)/.exec(c.className);
      decorate(p,m?m[1]:'Mã',function(){return (c||p).textContent.replace(/\n$/,'')},true);
    });
    doc.querySelectorAll('.mmd').forEach(function(d){
      decorate(d,'Sơ đồ',function(){if(d._src==null){var s=d.querySelector('.mmd-src');d._src=s?s.textContent:''}return d._src.replace(/\n$/,'')},false);
    });
    doc.querySelectorAll('.scroll').forEach(function(s){
      decorate(s,'Bảng',function(){
        return Array.prototype.map.call(s.querySelectorAll('tr'),function(r){
          return Array.prototype.map.call(r.children,function(x){return x.textContent.trim().replace(/\s+/g,' ')}).join('\t');
        }).join('\n');
      },false);
    });
  }

  function setMode(s){
    showSource=s; doc.style.display=s?'none':'block'; src.style.display=s?'block':'none';
    view.textContent=s?'Xem bản dựng':'Xem mã nguồn'; view.setAttribute('aria-pressed',String(s));
    $('tocBtn').hidden=s; ttsBtn.hidden=s;
    if(s){ttsStop();closeNote(true)}
    hideTb(); updProg(); refind();
  }
  function newRec(name,text,id){return {id:id||newId(),name:name,text:text,added:Date.now(),opened:Date.now(),anns:[]}}

  /* Kiểm tra trùng khi tải lên:
     1) Trùng nội dung (dù khác tên) -> không lưu thêm, mở bản đã có.
     2) Cùng tên nhưng nội dung khác -> hỏi cập nhật (chú thích cũ được gắn lại theo nội dung mới) hoặc giữ cả hai.
     3) Tệp không phải văn bản -> bỏ qua. */
  function addFile(f){return new Promise(function(res){
    if(!/\.(md|markdown|txt)$/i.test(f.name)&&!/^text\//.test(f.type)){
      notes.push('Bỏ qua "'+f.name+'" (không phải tệp văn bản)');return res(null)}
    var r=new FileReader();
    r.onload=function(){
      var text=String(r.result),h=hash(norm(text));
      var dup=records.find(function(x){return hOf(x)===h});
      if(dup){
        notes.push(dup.name===f.name?'"'+f.name+'" đã có trong thư viện, mở bản đã lưu'
          :'"'+f.name+'" trùng nội dung với "'+dup.name+'", mở bản đã lưu');
        return res(dup);
      }
      var rec=newRec(f.name,text); rec.h=h;
      var old=records.find(function(x){return x.name===f.name});
      if(old){
        var na=old.anns.length+(old.lost||[]).length;
        if(confirm('Đã có tệp "'+f.name+'" nhưng nội dung khác.\n\nOK: cập nhật bản cũ'+(na?' ('+na+' chú thích sẽ được tự gắn lại theo nội dung mới)':'')+'.\nHủy: giữ cả hai (bản mới lưu với tên khác).')){
          rec.id=old.id;rec.added=old.added;rec.pos=old.pos||0;notes.push('Đã cập nhật "'+f.name+'"');
          if(na){ensureAnchors(old);rec.anns=old.anns;rec.lost=old.lost||[];rec.plen=old.plen;rec.rv=RV;rec.reanchor=true;rec.announce=true}
        }else{rec.name=uniqueName(f.name);notes.push('Đã lưu thêm bản "'+rec.name+'"')}
      }
      res(rec);
    };
    r.onerror=function(){alert('Không đọc được tệp "'+f.name+'". Hãy thử lại.');res(null)};
    r.readAsText(f,'utf-8');
  })}
  function openFiles(files){
    var p=Promise.resolve(null);notes=[];
    Array.prototype.forEach.call(files,function(f){p=p.then(function(){return addFile(f)}).then(function(rec){
      if(rec){records=records.filter(function(x){return x.id!==rec.id});records.unshift(rec);
        tx('readwrite',function(s){return s.put(rec)}).catch(function(){});return rec}return null})});
    p.then(function(last){var m=last?open(last):'';if(m)notes.push(m);if(notes.length)toast(notes.join(' · '))});
  }

  /* ---------- Chú thích: highlight / gạch chân / ghi chú ---------- */
  /* Vị trí của điểm (node, off) trong toàn văn: chỉ đếm chữ ngoài [data-noann] (công thức, sơ đồ) */
  function offsetOf(node,off){
    var r=document.createRange();r.setStart(doc,0);r.setEnd(node,off);
    var w=textWalker(doc),n,len=0;
    while((n=w.nextNode())){
      if(n===node)return len+Math.min(off,n.length);
      if(r.comparePoint(n,n.length)!==0)break; // đã vượt qua điểm cần tính
      len+=n.length;
    }
    return len;
  }
  function findAnn(id){return cur&&cur.anns.find(function(x){return x.id===id})}
  function annEl(id){return doc.querySelector('.a[data-id="'+id+'"]')}
  function placeTb(rect){
    var w=tb.offsetWidth,h=tb.offsetHeight,top;
    if(coarse){top=rect.bottom+10;if(top+h>innerHeight-8)top=rect.top-h-10} // điện thoại: tránh menu chọn chữ của hệ thống ở phía trên
    else{top=rect.top-h-8;if(top<60)top=rect.bottom+8}
    tb.style.top=Math.max(8,Math.min(innerHeight-h-8,top))+'px';
    tb.style.left=Math.max(8,Math.min(innerWidth-w-8,rect.left+rect.width/2-w/2))+'px';
  }
  function showTb(rect,mode){
    tb.innerHTML='';
    function b(cls,txt,label,fn){var x=document.createElement('button');x.className=cls;x.textContent=txt;x.title=label;x.setAttribute('aria-label',label);
      x.addEventListener('mousedown',function(e){e.preventDefault()});x.addEventListener('click',fn);tb.appendChild(x);return x}
    var a=mode==='edit'?findAnn(editId):null;
    if(mode==='add'&&reatt){
      b('nx ok','Gắn chú thích vào đây','Gắn chú thích bị lạc vào đoạn đang bôi đen',reattach);
      var s0=document.createElement('span');s0.className='sep';tb.appendChild(s0);
    }
    COLORS.forEach(function(c,i){
      var d=b('dot','','Highlight '+c[1].toLowerCase()+(mode==='add'?' (phím '+(i+1)+')':''),
        function(){mode==='add'?addAnn('hl',c[0]):setAnn('hl',c[0])});
      d.dataset.c=c[0]; if(a&&a.t==='hl'&&a.c===c[0])d.setAttribute('aria-pressed','true');
    });
    var u=b('u','U','Gạch chân'+(mode==='add'?' (phím U)':''),function(){mode==='add'?addAnn('ul'):setAnn('ul')});
    if(a&&a.t==='ul')u.setAttribute('aria-pressed','true');
    var s=document.createElement('span');s.className='sep';tb.appendChild(s);
    if(mode==='add'){
      b('nx','Ghi chú','Thêm ghi chú dạng giấy note (phím N)',function(){addAnn('nt')});
      b('nx','Đọc','Đọc từ đoạn này (phím R)',ttsFromSel);
    }else{
      b('nx',a&&a.txt?'Sửa ghi chú':'Ghi chú','Ghi chú cho đoạn này',function(){var id=editId;hideTb();var el=annEl(id);if(el)openNote(id,el.getBoundingClientRect(),false)});
      b('nx','Sao chép','Sao chép đoạn này',function(){if(a)copyText(annText(a),this)});
      b('rm','Xóa','Xóa chú thích',removeAnn);
    }
    tb.style.display='flex'; placeTb(rect);
  }
  function hideTb(){tb.style.display='none';pend=null;editId=null}
  function addAnn(t,c){
    if(!pend||!cur)return;
    var a={id:newId(),s:pend.s,e:pend.e,t:t};
    if(t==='hl')a.c=c||'y'; if(t==='nt')a.txt='';
    anchor(a,plain);
    cur.anns.push(a); getSelection().removeAllRanges(); hideTb(); paint();
    var el=annEl(a.id);
    if(!el){cur.anns.pop();paint();return} // vùng chọn chỉ có khoảng trắng
    save();
    if(t==='nt')openNote(a.id,el.getBoundingClientRect(),true);
  }
  /* Chú thích bị lạc: người dùng bôi đen đoạn mới rồi bấm "Gắn chú thích vào đây" */
  var reatt=null;
  function startReattach(id){
    reatt=id; closeLib();
    toast('Bôi đen đoạn mới rồi bấm "Gắn chú thích vào đây". Nhấn Esc để hủy');
  }
  function reattach(){
    if(!pend||!cur||!reatt)return;
    var lost=cur.lost||[],a=lost.find(function(x){return x.id===reatt});
    reatt=null; if(!a){hideTb();return}
    var s=pend.s,e=pend.e; if(!plain.slice(s,e).trim()){hideTb();return}
    a.s=s;a.e=e;anchor(a,plain);
    cur.lost=lost.filter(function(x){return x!==a});cur.anns.push(a);
    getSelection().removeAllRanges(); hideTb(); paint(); save();
    toast('Đã gắn lại chú thích'); jumpTo(a.id);
  }
  function dropLost(id){
    if(!cur)return;
    cur.lost=(cur.lost||[]).filter(function(x){return id!=null&&x.id!==id});
    if(reatt&&(id==null||reatt===id))reatt=null;
    drawAnnList(); save();
  }
  function setAnn(t,c){ // đổi loại / màu, giữ nguyên ghi chú đã viết
    var a=findAnn(editId);if(!a)return;
    if(a.t==='nt'&&!a.txt&&t!=='nt')delete a.txt;
    a.t=t; if(t==='hl')a.c=c; else delete a.c;
    hideTb(); paint(); save();
  }
  function removeAnn(){
    if(!editId||!cur)return; var id=editId;
    cur.anns=cur.anns.filter(function(a){return a.id!==id});
    hideTb(); paint(); save();
  }
  var selT;
  document.addEventListener('selectionchange',function(){
    clearTimeout(selT);
    selT=setTimeout(function(){
      var sel=getSelection();
      if(!cur||showSource||!sel.rangeCount||sel.isCollapsed){if(pend)hideTb();return}
      var r=sel.getRangeAt(0);
      if(!doc.contains(r.commonAncestorContainer))return;
      var s=offsetOf(r.startContainer,r.startOffset),e=offsetOf(r.endContainer,r.endOffset);
      if(e<=s)return;
      pend={s:s,e:e}; editId=null; showTb(r.getBoundingClientRect(),'add');
    },180);
  });
  /* Bấm vào chú thích: ghi chú thì mở tờ giấy, còn lại hiện thanh sửa (đổi màu, thêm ghi chú, sao chép, xóa) */
  doc.addEventListener('click',function(e){
    if(!getSelection().isCollapsed)return;
    var el=e.target.closest&&e.target.closest('.a[data-id]');
    if(!el){if(editId)hideTb();return}
    e.stopPropagation();
    var id=el.dataset.id;
    if(snId&&snId!==id){closeNote(true);el=annEl(id);if(!el)return}
    var a=findAnn(id);if(!a)return;
    if(a.t==='nt'){hideTb();openNote(id,el.getBoundingClientRect(),false)}
    else{editId=id;pend=null;showTb(el.getBoundingClientRect(),'edit')}
  });
  document.addEventListener('click',function(e){
    if(tb.contains(e.target))return;
    if(editId)hideTb();
    if(!snEl.hidden&&!snEl.contains(e.target))closeNote(true);
  });

  /* ---------- Tờ giấy note ---------- */
  function placeNote(rect){
    if(coarse)return; // điện thoại: CSS ghim cố định ở trên
    var w=snEl.offsetWidth,h=snEl.offsetHeight,top=rect.bottom+12;
    if(top+h>innerHeight-8)top=Math.max(8,rect.top-h-12);
    snEl.style.top=top+'px';
    snEl.style.left=Math.max(8,Math.min(innerWidth-w-8,rect.left))+'px';
  }
  function openNote(id,rect,isNew){
    if(snId&&snId!==id){closeNote(true);var again=annEl(id);if(again)rect=again.getBoundingClientRect()}
    var a=findAnn(id); if(!a)return;
    snId=id; snNew=!!isNew;
    var q=annText(a);
    $('snq').textContent=q.length>90?q.slice(0,90)+'…':q;
    $('snt').value=a.txt||'';
    snEl.hidden=false; placeNote(rect);
    $('snt').focus({preventScroll:true});
  }
  /* keep=true: lưu (trống = xóa ghi chú; nếu là loại "nt" thì xóa luôn chú thích). keep=false: bỏ thay đổi. */
  function closeNote(keep){
    var id=snId; snId=null;
    if(snEl.hidden)return; snEl.hidden=true;
    if(!id||!cur)return;
    var a=findAnn(id); if(!a)return;
    var txt=$('snt').value.trim(),drop1=function(){cur.anns=cur.anns.filter(function(x){return x.id!==id})};
    if(!keep){if(snNew&&a.t==='nt'){drop1();paint();save()}return}
    if(txt){if(txt!==a.txt){a.txt=txt;paint();save()}}
    else if(a.t==='nt'){drop1();paint();save()}
    else if(a.txt){delete a.txt;paint();save()}
  }
  $('snOk').addEventListener('click',function(){closeNote(true)});
  $('snDel').addEventListener('click',function(){$('snt').value='';closeNote(true)});
  snEl.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();closeNote(true)}});

  /* ---------- Danh sách chú thích + xuất ---------- */
  function sortedAnns(){return cur?cur.anns.slice().sort(function(x,y){return x.s-y.s||x.e-y.e}):[]}
  function drawAnnList(){
    var ul=$('annList');ul.innerHTML='';
    var n=cur?cur.anns.length:0,lost=cur&&cur.lost||[];
    $('annN').textContent=n||lost.length?'('+n+(lost.length?' · '+lost.length+' lạc':'')+')':'';
    var arr=sortedAnns().filter(function(a){return !annFilter||(annFilter==='nt'?(a.t==='nt'||!!a.txt):a.t===annFilter)});
    if(lost.length)drawLost(ul,lost);
    if(!arr.length){var e=document.createElement('li');e.className='empty';
      e.textContent=!cur?'Hãy mở một tệp.':n?'Không có chú thích nào khớp bộ lọc.':'Chưa có chú thích. Bôi đen chữ để highlight, gạch chân hoặc ghi chú.';
      ul.appendChild(e);return}
    arr.forEach(function(a){
      var li=document.createElement('li'),b=document.createElement('button');
      b.style.setProperty('--c',annColor(a)); b.title=annLabel(a)+' · bấm để tới đoạn này';
      var h=annHead(a);
      if(h){var hs=document.createElement('span');hs.className='ah';hs.textContent=h;b.appendChild(hs)}
      var q=document.createElement('span');q.className='aq';q.textContent='“'+annText(a)+'”';b.appendChild(q);
      if(a.txt){var ns=document.createElement('span');ns.className='an';ns.textContent=a.txt;b.appendChild(ns)}
      b.addEventListener('click',function(){jumpTo(a.id)});
      li.appendChild(b);ul.appendChild(li);
    });
  }
  /* Chú thích không tìm lại được sau khi nội dung đổi: hiện ở đầu danh sách để gắn lại hoặc xóa */
  function drawLost(ul,lost){
    var h=document.createElement('li');h.className='lostH';
    var t=document.createElement('span');t.textContent='Bị lạc sau khi tệp thay đổi ('+lost.length+')';h.appendChild(t);
    var all=document.createElement('button');all.textContent='Xóa hết';all.className='rm';
    all.addEventListener('click',function(){if(confirm('Xóa '+lost.length+' chú thích bị lạc?'))dropLost(null)});
    h.appendChild(all);ul.appendChild(h);
    lost.forEach(function(a){
      var li=document.createElement('li');li.className='lostIt';li.style.setProperty('--c',annColor(a));
      var q=document.createElement('span');q.className='aq';q.textContent='“'+(a.q||'').replace(/\s+/g,' ').trim()+'”';li.appendChild(q);
      if(a.txt){var ns=document.createElement('span');ns.className='an';ns.textContent=a.txt;li.appendChild(ns)}
      var acts=document.createElement('div');acts.className='acts';
      var g=document.createElement('button');g.textContent=reatt===a.id?'Đang chờ bôi đen…':'Gắn lại';g.className='ok';
      g.title='Bôi đen đoạn tương ứng trong tài liệu để gắn chú thích này vào';
      g.addEventListener('click',function(){startReattach(a.id)});
      var c=document.createElement('button');c.textContent='Sao chép';
      c.addEventListener('click',function(){copyText(a.q+(a.txt?'\n\n'+a.txt:''),c)});
      var d=document.createElement('button');d.textContent='Xóa';d.className='rm';
      d.addEventListener('click',function(){dropLost(a.id)});
      acts.appendChild(g);acts.appendChild(c);acts.appendChild(d);li.appendChild(acts);ul.appendChild(li);
    });
  }
  function jumpTo(id){
    var el=annEl(id);if(!el)return;
    if(innerWidth<900)closeLib();
    el.scrollIntoView({behavior:'smooth',block:'center'});
    doc.querySelectorAll('.a[data-id="'+id+'"]').forEach(function(x){x.classList.remove('flash');void x.offsetWidth;x.classList.add('flash')});
  }
  function annMd(){
    var arr=sortedAnns(),out=['# Chú thích: '+cur.name,'','_Xuất ngày '+new Date().toLocaleDateString('vi-VN')+', '+arr.length+' chú thích_',''],lastH=null;
    arr.forEach(function(a){
      var h=annHead(a)||'Phần mở đầu';
      if(h!==lastH){lastH=h;out.push('## '+h,'')}
      out.push('> '+annText(a),'','- *'+annLabel(a)+'*'+(a.txt?': '+a.txt.replace(/\n+/g,' / '):''),'');
    });
    var lost=cur.lost||[];
    if(lost.length){
      out.push('## Chú thích bị lạc','','_Không còn tìm thấy đoạn này trong bản hiện tại của tệp._','');
      lost.forEach(function(a){out.push('> '+(a.q||'').replace(/\s+/g,' ').trim(),'','- *'+annLabel(a)+'*'+(a.txt?': '+a.txt.replace(/\n+/g,' / '):''),'')});
    }
    return out.join('\n');
  }
  $('annF').addEventListener('change',function(){annFilter=this.value;drawAnnList()});
  $('annCp').addEventListener('click',function(){
    if(!cur||!cur.anns.length){toast('Tài liệu này chưa có chú thích');return}
    copyText(annMd(),this); toast('Đã sao chép '+cur.anns.length+' chú thích');
  });
  $('annExp').addEventListener('click',function(){
    if(!cur||!cur.anns.length){toast('Tài liệu này chưa có chú thích');return}
    var base=cur.name.replace(/\.[^.]*$/,'');
    downloadText(base+'-chu-thich.md',annMd(),'text/markdown','Đã xuất '+cur.anns.length+' chú thích');
  });

  /* ---------- Thư viện ---------- */
  function fmtDate(t){try{return new Date(t).toLocaleDateString('vi-VN')}catch(e){return ''}}
  function dayLabel(t){
    var d=new Date(t),n=new Date();d.setHours(0,0,0,0);n.setHours(0,0,0,0);
    var diff=Math.round((n-d)/864e5);
    if(diff<=0)return 'Hôm nay'; if(diff===1)return 'Hôm qua'; if(diff<=7)return '7 ngày qua'; if(diff<=30)return '30 ngày qua';
    return 'Tháng '+(d.getMonth()+1)+'/'+d.getFullYear();
  }
  function fold(s){ // bỏ dấu, hạ chữ thường, giữ nguyên độ dài
    s=s.normalize('NFC');var o='',i,c;
    for(i=0;i<s.length;i++){c=s.charAt(i);o+=(c==='đ'||c==='Đ')?'d':c.normalize('NFD').charAt(0).toLowerCase()}
    return o;
  }
  var fc=new WeakMap(),query='',sortBy=lsGet('md-sort')||'opened';
  function folded(r){var c=fc.get(r);
    if(!c||c.t!==r.text){c={t:r.text,n:fold(r.name),f:fold(r.text),raw:r.text.normalize('NFC')};fc.set(r,c)}return c}
  function drawList(){
    list.innerHTML='';
    var terms=fold(query.trim()).split(/\s+/).filter(Boolean),rows=[];
    records.forEach(function(r){
      var c=folded(r),hit=null;
      if(terms.length){
        var nt=fold(r.anns.map(function(a){return a.txt||''}).join(' '));
        var all=c.n+' '+c.f+' '+nt;
        if(!terms.every(function(t){return all.indexOf(t)>=0}))return;
        var j=c.f.indexOf(terms[0]);
        if(j>=0)hit={a:c.raw.slice(Math.max(0,j-28),j).replace(/\s+/g,' '),m:c.raw.substr(j,terms[0].length),
          b:c.raw.slice(j+terms[0].length,j+terms[0].length+60).replace(/\s+/g,' '),pre:j>28};
      }
      rows.push({r:r,hit:hit});
    });
    if(sortBy==='name')rows.sort(function(x,y){return x.r.name.localeCompare(y.r.name,'vi')});
    else rows.sort(function(x,y){return y.r[sortBy]-x.r[sortBy]});
    if(!rows.length){var p=document.createElement('li');p.className='empty';
      p.textContent=records.length?'Không có tệp nào khớp "'+query.trim()+'".':'Chưa có tệp nào. Mở một tệp .md để lưu vào đây.';
      list.appendChild(p);return}
    var lastG=null;
    rows.forEach(function(row){
      var r=row.r;
      if(sortBy!=='name'){var g=dayLabel(r[sortBy]);
        if(g!==lastG){lastG=g;var h=document.createElement('li');h.className='grp';h.textContent=g;list.appendChild(h)}}
      var li=document.createElement('li'),b=document.createElement('button'),d=document.createElement('button');
      b.className='it'+(cur&&cur.id===r.id?' cur':'');
      var t=document.createElement('span'),m=document.createElement('span');t.className='t';m.className='m';
      t.textContent=r.name;
      m.textContent=Math.max(1,Math.round(r.text.length/1024))+' KB · '+r.anns.length+' chú thích · '+fmtDate(r[sortBy==='added'?'added':'opened'])+(r.pos>0.01?' · đọc '+Math.round(r.pos*100)+'%':'');
      b.appendChild(t);b.appendChild(m);
      if(row.hit){var s=document.createElement('span'),k=document.createElement('b'),hh=row.hit;
        s.className='s';k.textContent=hh.m;
        s.appendChild(document.createTextNode((hh.pre?'…':'')+hh.a));s.appendChild(k);s.appendChild(document.createTextNode(hh.b+'…'));b.appendChild(s)}
      b.addEventListener('click',function(){open(r)});
      d.className='del';d.textContent='Xóa';d.setAttribute('aria-label','Xóa '+r.name);
      d.addEventListener('click',function(){
        if(!confirm('Xóa "'+r.name+'" khỏi thư viện? Các chú thích cũng sẽ mất.'))return;
        records=records.filter(function(x){return x.id!==r.id});
        tx('readwrite',function(s){return s.delete(r.id)}).catch(function(){});
        if(cur&&cur.id===r.id){closeDoc();openLib()}
        drawList();
      });
      li.appendChild(b);li.appendChild(d);list.appendChild(li);
    });
  }
  $('q').addEventListener('input',function(e){query=e.target.value;drawList()});
  $('sort').value=sortBy;
  $('sort').addEventListener('change',function(e){sortBy=e.target.value;lsSet('md-sort',sortBy);drawList()});

  /* ---------- Bảng bên ---------- */
  function openLib(){$('toc').classList.remove('open');$('tocBtn').setAttribute('aria-expanded','false');$('lib').classList.add('open');$('scrim').style.display='block';$('libBtn').setAttribute('aria-expanded','true')}
  function closeLib(){$('lib').classList.remove('open');$('toc').classList.remove('open');$('tocBtn').setAttribute('aria-expanded','false');$('scrim').style.display='none';$('libBtn').setAttribute('aria-expanded','false')}
  function setTab(t){
    var ann=t==='ann';
    $('tabToc').setAttribute('aria-selected',String(!ann));$('tabAnn').setAttribute('aria-selected',String(ann));
    $('tocList').hidden=ann;$('annBox').hidden=!ann; lsSet('md-tab',t);
    if(!ann)markToc();
  }
  function openSide(t){
    $('lib').classList.remove('open');$('libBtn').setAttribute('aria-expanded','false');
    setTab(t||lsGet('md-tab')||'toc');
    $('toc').classList.add('open');$('scrim').style.display='block';$('tocBtn').setAttribute('aria-expanded','true');
  }
  function toggleSide(t){
    var isOpen=$('toc').classList.contains('open'),curTab=$('tabAnn').getAttribute('aria-selected')==='true'?'ann':'toc';
    if(isOpen&&curTab===t)closeLib();else openSide(t);
  }
  $('libBtn').addEventListener('click',openLib);$('closeLib').addEventListener('click',closeLib);$('scrim').addEventListener('click',closeLib);
  $('tocBtn').addEventListener('click',function(){openSide()});
  $('closeToc').addEventListener('click',closeLib);
  $('tabToc').addEventListener('click',function(){setTab('toc')});
  $('tabAnn').addEventListener('click',function(){setTab('ann')});

  /* ---------- Nhập tệp ---------- */
  $('file').addEventListener('change',function(e){if(e.target.files.length)openFiles(e.target.files);e.target.value=''});
  $('pick').addEventListener('click',function(){$('file').click()});
  view.addEventListener('click',function(){setMode(!showSource)});
  $('pasteBtn').addEventListener('click',function(){paste.style.display='block';paste.focus()});
  var pt;
  paste.addEventListener('input',function(){
    clearTimeout(pt);
    pt=setTimeout(function(){
      var text=paste.value; if(!text.trim())return;
      var old=records.find(function(x){return x.id==='paste'});
      var rec=old||newRec('Nội dung đã dán',text,'paste');
      if(old&&old.text!==text&&(old.anns.length||(old.lost||[]).length)){ensureAnchors(old);rec.rv=RV;rec.reanchor=true}
      rec.text=text; rec.h=null; open(rec);
    },500);
  });
  ['dragenter','dragover'].forEach(function(ev){window.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('over')})});
  ['dragleave','drop'].forEach(function(ev){window.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('over')})});
  window.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files.length)openFiles(e.dataTransfer.files)});

  /* ---------- Giao diện sáng / tối ---------- */
  $('theme').addEventListener('click',function(){
    var root=document.documentElement,c=root.getAttribute('data-theme');
    if(!c)c=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
    var n=c==='dark'?'light':'dark'; root.setAttribute('data-theme',n);
    lsSet('md-theme',n); readStar();
    if(cur&&!showSource)fillMermaid(); // vẽ lại sơ đồ theo màu mới
  });
  (function(){var s=lsGet('md-theme');if(s)document.documentElement.setAttribute('data-theme',s)})();

  /* ---------- Nền sao động (chỉ chạy khi đang hiện và tab đang mở) ---------- */
  var cv=$('sky'),cx=cv.getContext('2d'),W=0,H=0,stars=[],shoot=null,starRGB='255,255,255',nextShoot=0,raf=0;
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function readStar(){starRGB=getComputedStyle(document.documentElement).getPropertyValue('--star').trim()||'255,255,255';if(still||!raf)frame(performance.now())}
  function size(){
    var d=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;cv.width=W*d;cv.height=H*d;cx.setTransform(d,0,0,d,0,0);
    var n=Math.min(260,Math.round(W*H/5500));stars=[];
    for(var i=0;i<n;i++)stars.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.25+.25,p:Math.random()*6.28,s:Math.random()*1.6+.5,v:Math.random()*.12+.02});
    if(still||!raf)frame(0);
  }
  function frame(t){
    cx.clearRect(0,0,W,H);
    var k=starRGB!=='255,255,255'?.5:1,move=!still&&raf;
    for(var i=0;i<stars.length;i++){var s=stars[i];
      if(move){s.y-=s.v;s.x+=s.v*.35;if(s.y<-2){s.y=H+2;s.x=Math.random()*W}if(s.x>W+2)s.x=-2}
      var a=(.3+.7*(Math.sin(t*.001*s.s+s.p)+1)/2)*k;
      cx.fillStyle='rgba('+starRGB+','+a.toFixed(3)+')';cx.beginPath();cx.arc(s.x,s.y,s.r,0,6.283);cx.fill();
      if(s.r>1.15){cx.fillStyle='rgba('+starRGB+','+(a*.12).toFixed(3)+')';cx.beginPath();cx.arc(s.x,s.y,s.r*3.2,0,6.283);cx.fill()}
    }
    if(move){
      if(!shoot&&t>nextShoot){shoot={x:Math.random()*W*.8+W*.2,y:Math.random()*H*.35,vx:-7-Math.random()*4,vy:3+Math.random()*2,life:1};nextShoot=t+5000+Math.random()*9000}
      if(shoot){var g=cx.createLinearGradient(shoot.x,shoot.y,shoot.x-shoot.vx*9,shoot.y-shoot.vy*9);
        g.addColorStop(0,'rgba('+starRGB+','+(.9*shoot.life*k)+')');g.addColorStop(1,'rgba('+starRGB+',0)');
        cx.strokeStyle=g;cx.lineWidth=1.6;cx.beginPath();cx.moveTo(shoot.x,shoot.y);cx.lineTo(shoot.x-shoot.vx*9,shoot.y-shoot.vy*9);cx.stroke();
        shoot.x+=shoot.vx;shoot.y+=shoot.vy;shoot.life-=.014;if(shoot.life<=0)shoot=null}
    }
  }
  function loop(t){frame(t);raf=requestAnimationFrame(loop)}
  function startSky(){if(still||raf||!stT.checked||document.hidden)return;raf=requestAnimationFrame(loop)}
  function stopSky(){cancelAnimationFrame(raf);raf=0}
  if(lsGet('md-stars')==='0'){stT.checked=false;cv.style.display='none'}
  stT.addEventListener('change',function(){
    cv.style.display=stT.checked?'':'none';lsSet('md-stars',stT.checked?'1':'0');
    if(stT.checked){size();startSky()}else stopSky();
  });
  document.addEventListener('visibilitychange',function(){document.hidden?stopSky():startSky()});
  addEventListener('resize',size);size();readStar();startSky();
  if(matchMedia('(prefers-color-scheme: dark)').addEventListener)matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){readStar();if(cur)fillMermaid()});

  /* ---------- Kích thước: thiết bị, kéo tay, cỡ chữ ---------- */
  var root=document.documentElement,sheet=$('sheet'),wr=$('wr'),badge=$('wbadge'),vw=768,pct=100,drag=null;
  function maxW(){return Math.max(320,innerWidth-32)}
  function applyW(v,persist){
    vw=v; root.style.setProperty('--w',v==='full'?'100%':v+'px');
    var cw=sheet.offsetWidth; $('wv').textContent=cw+'px';
    wr.max=Math.min(1600,maxW()); wr.value=Math.min(Math.max(cw,320),+wr.max);
    vp.querySelectorAll('[data-w]').forEach(function(b){b.setAttribute('aria-pressed',String(String(v)===b.dataset.w))});
    if(persist)lsSet('md-w',String(v));
  }
  function applyFs(p,persist){
    pct=Math.min(160,Math.max(70,p)); root.style.setProperty('--fs',pct/100); $('fv').textContent=pct+'%';
    if(persist)lsSet('md-fs',String(pct));
  }
  var sw0=lsGet('md-w'); applyW(sw0==='full'?'full':(+sw0>=320?+sw0:768)); applyFs(+lsGet('md-fs')||100);
  vp.querySelectorAll('[data-w]').forEach(function(b){b.addEventListener('click',function(){var w=b.dataset.w;applyW(w==='full'?'full':+w,true)})});
  wr.addEventListener('input',function(){applyW(+wr.value,true)});
  $('fm').addEventListener('click',function(){applyFs(pct-10,true)});
  $('fp').addEventListener('click',function(){applyFs(pct+10,true)});
  $('rs').addEventListener('click',function(){applyW(768,true);applyFs(100,true)});
  addEventListener('resize',function(){applyW(vw)});
  sheet.querySelectorAll('.grip').forEach(function(g){
    g.addEventListener('pointerdown',function(e){
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      drag={x:e.clientX,w:sheet.offsetWidth,s:g.dataset.s,g:g}; g.classList.add('on'); badge.hidden=false; document.body.style.userSelect='none';
    });
    g.addEventListener('pointermove',function(e){
      if(!drag)return;
      var dx=(e.clientX-drag.x)*(drag.s==='r'?1:-1)*2, w=Math.round(Math.min(maxW(),Math.max(320,drag.w+dx)));
      applyW(w); badge.textContent=w+' px';
    });
    function end(){if(!drag)return; drag.g.classList.remove('on'); lsSet('md-w',String(vw)); drag=null; badge.hidden=true; document.body.style.userSelect=''}
    g.addEventListener('pointerup',end); g.addEventListener('pointercancel',end);
    g.addEventListener('dblclick',function(){applyW(768,true)});
  });
  $('vpBtn').addEventListener('click',function(e){e.stopPropagation();var o=vp.hidden;vp.hidden=!o;this.setAttribute('aria-expanded',String(o));if(o)closeEx()});
  document.addEventListener('click',function(e){if(!vp.hidden&&!vp.contains(e.target)){vp.hidden=true;$('vpBtn').setAttribute('aria-expanded','false')}});

  /* ---------- Hình nền: màu/gradient có sẵn hoặc ảnh tự tải lên ---------- */
  var PRE=[['Mặc định',null,null],['Đêm','#080d1a','#14211f'],['Hoàng hôn','#ffd9c0','#e8a0bf'],['Biển','#cfe9f5','#7fb8cf'],
           ['Tím','#2a1b4d','#5b3a8c'],['Giấy','#f6f1e7','#e6dcc6'],['Rừng','#d6e8d0','#7fae8c'],['Than','#121212','#2a2a2a']];
  var swEl=$('sw');
  function setBgCss(a,b,img){
    var st=root.style;
    ['--bg1','--bg2','--bgi'].forEach(function(p){st.removeProperty(p)});
    if(a){st.setProperty('--bg1',a);st.setProperty('--bg2',b)}
    if(img)st.setProperty('--bgi','url("'+img+'")');
  }
  function markBg(k){
    swEl.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.k===k))});
    $('bgRm').disabled=k!=='img';
  }
  function usePre(i,persist){var p=PRE[i];setBgCss(p[1],p[2]);markBg('p'+i);if(persist)lsSet('md-bg','p'+i)}
  function useImg(url,persist){setBgCss(null,null,url);markBg('img');if(persist)lsSet('md-bg','img')}
  PRE.forEach(function(p,i){
    var b=document.createElement('button');b.dataset.k='p'+i;b.title=p[0];b.setAttribute('aria-label','Nền '+p[0]);
    b.setAttribute('aria-pressed','false');
    b.style.background='linear-gradient(135deg,'+(p[1]||'#f5f5f5')+','+(p[2]||'#1c1c1c')+')';
    b.addEventListener('click',function(){usePre(i,true)});swEl.appendChild(b);
  });
  $('bgUp').addEventListener('click',function(){$('bgfile').click()});
  $('bgfile').addEventListener('change',function(e){
    var f=e.target.files[0];e.target.value='';if(!f)return;
    if(!/^image\//.test(f.type)){toast('Hãy chọn một tệp ảnh');return}
    var u=URL.createObjectURL(f),im=new Image();
    im.onload=function(){ // thu nhỏ còn tối đa 1920px để lưu gọn trong trình duyệt
      var k=Math.min(1,1920/Math.max(im.width,im.height)),c=document.createElement('canvas');
      c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);
      c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);
      var d=c.toDataURL('image/jpeg',.82);useImg(d,true);
      tx('readwrite',function(s){return s.put(d,'bg')},'prefs').catch(function(){toast('Không lưu được ảnh nền, ảnh sẽ mất khi tải lại trang')});
    };
    im.onerror=function(){URL.revokeObjectURL(u);toast('Không đọc được ảnh này')};
    im.src=u;
  });
  $('bgRm').addEventListener('click',function(){
    tx('readwrite',function(s){return s.delete('bg')},'prefs').catch(function(){});usePre(0,true);
  });
  var bk=lsGet('md-bg')||'p0';
  if(bk==='img'){
    markBg('img');
    tx('readonly',function(s){return s.get('bg')},'prefs').then(function(d){if(d)useImg(d);else usePre(0,true)}).catch(function(){usePre(0)});
  }else usePre(Math.min(+bk.slice(1)||0,PRE.length-1));

  /* ---------- Mục lục + nhớ vị trí đọc ---------- */
  var heads=[],restoring=false,userMoved=false,posT,tick=false;
  function maxScroll(){return Math.max(0,document.documentElement.scrollHeight-innerHeight)}
  function updProg(){
    var m=maxScroll(),f=m>0?Math.min(1,Math.max(0,scrollY/m)):0;
    $('prog').style.width=(cur&&!showSource?f*100:0)+'%';return f;
  }
  function buildToc(){
    heads=Array.prototype.slice.call(doc.querySelectorAll('h1,h2,h3,h4'));
    var ul=$('tocList');ul.innerHTML='';
    if(!heads.length){var e=document.createElement('li');e.className='empty';e.textContent='Tài liệu này không có tiêu đề.';ul.appendChild(e);return}
    var base=Math.min.apply(null,heads.map(function(h){return +h.tagName.charAt(1)}));
    heads.forEach(function(h,i){
      h.id='h-'+i;
      var li=document.createElement('li'),a=document.createElement('a');
      a.href='#h-'+i;a.className='l'+(+h.tagName.charAt(1)-base+1);a.textContent=h.textContent.trim();a.dataset.i=i;
      a.addEventListener('click',function(e){e.preventDefault();h.scrollIntoView({behavior:'smooth',block:'start'});if(innerWidth<900)closeLib()});
      li.appendChild(a);ul.appendChild(li);
    });
    markToc();
  }
  function markToc(){
    if(!heads.length)return;
    var idx=0,i;
    for(i=0;i<heads.length;i++){if(heads[i].getBoundingClientRect().top<=100)idx=i;else break}
    var as=$('tocList').querySelectorAll('a');
    as.forEach(function(a){a.classList.toggle('on',+a.dataset.i===idx)});
    if(as[idx]&&$('toc').classList.contains('open')&&!$('tocList').hidden)as[idx].scrollIntoView({block:'nearest'});
  }
  function restorePos(rec){
    var f=rec.pos||0;userMoved=false;window.scrollTo(0,0);
    function go(){restoring=true;window.scrollTo(0,f*maxScroll());setTimeout(function(){restoring=false;updProg();markToc()},80)}
    if(f>0.01){go();setTimeout(function(){if(cur===rec&&!userMoved)go()},400);
      toast('Tiếp tục từ vị trí đã đọc ('+Math.round(f*100)+'%)')}
    updProg();
  }
  function savePos(){
    if(!cur||showSource||restoring)return;
    var f=updProg();cur.pos=f>0.98?0:+f.toFixed(4); // đọc xong thì lần sau mở lại từ đầu
    tx('readwrite',function(s){return s.put(cur)}).catch(function(){});
  }
  ['wheel','touchstart','keydown','mousedown'].forEach(function(ev){window.addEventListener(ev,function(){userMoved=true},{passive:true})});
  window.addEventListener('scroll',function(){
    if(editId)hideTb();
    if(!cur||showSource)return;
    if(!tick){tick=true;requestAnimationFrame(function(){
      tick=false;updProg();markToc();
      if(pend&&tb.style.display==='flex'){var s=getSelection();if(s.rangeCount&&!s.isCollapsed)placeTb(s.getRangeAt(0).getBoundingClientRect())}
      if(snId){var el=annEl(snId);if(el)placeNote(el.getBoundingClientRect())}
    })}
    if(restoring)return;
    clearTimeout(posT);posT=setTimeout(savePos,600);
  },{passive:true});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){clearTimeout(posT);savePos()}});

  /* ---------- Sao lưu / khôi phục thư viện ---------- */
  $('bkOut').addEventListener('click',function(){
    if(!records.length){toast('Thư viện đang trống, chưa có gì để sao lưu');return}
    var json=JSON.stringify({app:'mdviewer',version:2,exported:Date.now(),files:records.map(function(r){
      return {id:r.id,name:r.name,text:r.text,added:r.added,opened:r.opened,anns:r.anns,lost:r.lost||[],rv:r.rv||1,plen:r.plen||0,pos:r.pos||0}})});
    downloadText('thu-vien-markdown-'+stamp()+'.json',json,'application/json','Đã sao lưu '+records.length+' tệp kèm chú thích');
  });
  $('bkIn').addEventListener('click',function(){$('bkfile').click()});
  $('bkfile').addEventListener('change',function(e){
    var f=e.target.files[0];e.target.value='';if(!f)return;
    var r=new FileReader();
    r.onload=function(){
      var d;try{d=JSON.parse(String(r.result))}catch(x){}
      if(!d||d.app!=='mdviewer'||!Array.isArray(d.files)){toast('Đây không phải tệp sao lưu của trình xem này');return}
      var add=0,merged=0,skip=0,puts=[];
      function key(a){return a.s+'-'+a.e+'-'+a.t+'-'+(a.c||'')}
      d.files.forEach(function(x){
        if(!x||typeof x.text!=='string'||typeof x.name!=='string')return;
        var h=hash(norm(x.text)),dup=records.find(function(y){return hOf(y)===h});
        function clean(arr){
          return (Array.isArray(arr)?arr:[]).filter(function(a){return a&&typeof a.s==='number'&&typeof a.e==='number'&&a.e>a.s&&(a.t==='hl'||a.t==='ul'||a.t==='nt')})
            .map(function(a){
              a.id=newId();
              if(a.t==='hl'&&'ygbp'.indexOf(a.c)<0)a.c='y';
              if(typeof a.txt!=='string')delete a.txt;
              if(typeof a.q!=='string'){delete a.q;delete a.pre;delete a.suf}
              return a;
            });
        }
        // đưa chú thích trong bản sao lưu về cách dựng hiện tại trước khi gộp
        var np=plainOf(render(x.text));
        var tmp={text:x.text,anns:clean(x.anns),lost:clean(x.lost).filter(function(a){return typeof a.q==='string'}),rv:+x.rv||1,plen:+x.plen||0};
        upgrade(tmp,np);
        var anns=tmp.anns;
        if(dup){ // trùng nội dung: chỉ gộp thêm chú thích chưa có
          if(upgrade(dup,np))puts.push(dup);
          var have={},n=0;dup.anns.forEach(function(a){have[key(a)]=a});
          anns.forEach(function(a){
            var o=have[key(a)];
            if(!o){have[key(a)]=a;dup.anns.push(a);n++}
            else if(a.txt&&!o.txt){o.txt=a.txt;n++} // bản cũ thiếu ghi chú thì bổ sung
          });
          if(n){merged++;if(puts.indexOf(dup)<0)puts.push(dup)}else skip++;
          return;
        }
        var nm=records.some(function(y){return y.name===x.name})?uniqueName(x.name):x.name;
        var rec=newRec(nm,x.text);rec.h=h;rec.anns=anns;rec.lost=tmp.lost;rec.rv=RV;rec.plen=np.length;rec.pos=+x.pos||0;
        rec.added=+x.added||rec.added;rec.opened=+x.opened||rec.opened;
        records.push(rec);puts.push(rec);add++;
      });
      if(puts.length)tx('readwrite',function(s){puts.forEach(function(p){s.put(p)})}).catch(function(){toast('Một số tệp chưa lưu được vào trình duyệt')});
      if(cur&&puts.indexOf(cur)>=0)paint();
      drawList();
      toast('Khôi phục xong: thêm '+add+' tệp, gộp chú thích vào '+merged+' tệp, bỏ qua '+skip+' tệp đã có');
    };
    r.onerror=function(){toast('Không đọc được tệp sao lưu')};
    r.readAsText(f,'utf-8');
  });

  /* ---------- Đọc thành tiếng (Web Speech API) ---------- */
  var ttsVI=/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  function ttsSupported(){return 'speechSynthesis' in window&&'SpeechSynthesisUtterance' in window}
  /* Thứ tự đọc: tiêu đề, đoạn, mục danh sách, trích dẫn, dòng bảng. Bỏ qua code. */
  function ttsBlocks(){
    var out=[];
    doc.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,tr').forEach(function(el){
      if(el.closest('pre,.cbh,.mmd'))return;
      if(el.tagName==='BLOCKQUOTE'&&el.querySelector('p,li'))return;
      if(el.tagName==='LI'&&el.querySelector(':scope > p'))return;
      out.push(el);
    });
    return out;
  }
  function ttsText(el){
    var c=el.cloneNode(true);
    c.querySelectorAll('ul,ol,pre,.cbh,input,.mmd').forEach(function(x){x.remove()});
    c.querySelectorAll('.math').forEach(function(x){x.replaceWith(' (công thức) ')});
    var t=c.tagName==='TR'
      ?Array.prototype.map.call(c.children,function(x){return x.textContent.trim()}).join(', ')
      :c.textContent;
    return t.replace(/\s+/g,' ').trim();
  }
  /* Cắt câu dài thành đoạn <= ~180 ký tự để trình duyệt không ngắt giữa chừng */
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
    setTimeout(function(){ttsRead(i,g)},60); // chờ một nhịp sau cancel() để không bị nuốt câu đầu
  }
  function ttsStop(){
    ttsGen++;
    if(ttsSupported())ttsHalt();
    ttsMark(null); ttsPaused=false;
    ttsEl.hidden=true; document.body.classList.remove('tts-on'); ttsBtn.setAttribute('aria-pressed','false');
  }
  /* Tạm dừng bằng cách dừng hẳn rồi đọc lại đoạn hiện tại: chạy được cả trên Chrome Android,
     nơi speechSynthesis.pause() không có tác dụng. */
  function ttsPause(){ttsGen++;ttsHalt();ttsPaused=true;ttsSetPlay()}
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
  $('ttPlay').addEventListener('click',function(){if(ttsPaused)ttsStart(ttsIdx);else ttsPause()});
  $('ttRate').value=lsGet('md-tts-rate')||'1';
  $('ttRate').addEventListener('change',function(){lsSet('md-tts-rate',this.value); if(!ttsEl.hidden&&!ttsPaused)ttsStart(ttsIdx)});
  $('ttVoice').addEventListener('change',function(){lsSet('md-tts-voice',this.value); if(!ttsEl.hidden&&!ttsPaused)ttsStart(ttsIdx)});
  if(ttsSupported()){
    ttsFill();
    if(speechSynthesis.addEventListener)speechSynthesis.addEventListener('voiceschanged',ttsFill);
    else speechSynthesis.onvoiceschanged=ttsFill;
  }

  /* ---------- Tìm trong tài liệu ----------
     Dùng CSS Custom Highlight API: tô kết quả mà KHÔNG sửa DOM, nên không đụng tới
     các thẻ <mark>/<span> chú thích. Tìm không phân biệt dấu và hoa/thường. */
  var findEl=$('find'),fq=$('fq'),fcEl=$('fc'),FMAX=5000;
  var hasHL=!!(window.CSS&&CSS.highlights&&window.Highlight);
  var fIdx=null,fHits=[],fCur=-1,fT;
  /* Gập chữ về dạng không dấu, đồng thời giữ bảng ánh xạ vị trí về chuỗi gốc
     (xử lý được cả văn bản dạng NFD, nơi dấu là ký tự riêng). */
  function foldMap(s){
    var o=[],map=[],i,c,cc;
    for(i=0;i<s.length;i++){
      cc=s.charCodeAt(i); if(cc>=0x300&&cc<=0x36f)continue;
      c=s.charAt(i);
      o.push(c==='đ'||c==='Đ'?'d':c.normalize('NFD').charAt(0).toLowerCase().charAt(0)); map.push(i);
    }
    return {s:o.join(''),map:map};
  }
  function findIndex(){
    var w=showSource?document.createTreeWalker(src,NodeFilter.SHOW_TEXT):textWalker(doc),n,nodes=[],starts=[],parts=[],pos=0;
    while((n=w.nextNode())){
      var v=n.nodeValue; if(!v.length||(n.parentNode.closest&&n.parentNode.closest('.cbh')))continue;
      nodes.push(n);starts.push(pos);parts.push(v);pos+=v.length;
    }
    var raw=parts.join('');
    return {nodes:nodes,starts:starts,raw:raw,f:foldMap(raw)};
  }
  function nodeAt(off){var st=fIdx.starts,lo=0,hi=st.length-1;
    while(lo<hi){var m=(lo+hi+1)>>1;if(st[m]<=off)lo=m;else hi=m-1}return lo}
  function mkRange(h){
    var r=document.createRange(),a=nodeAt(h[0]),b=nodeAt(h[1]-1);
    r.setStart(fIdx.nodes[a],h[0]-fIdx.starts[a]); r.setEnd(fIdx.nodes[b],h[1]-fIdx.starts[b]); return r;
  }
  function clearHL(){if(hasHL){CSS.highlights.delete('find');CSS.highlights.delete('find-cur')}}
  function drawCount(){
    var q=fq.value.trim();
    fcEl.textContent=!q?'':fHits.length?(fCur+1)+'/'+fHits.length+(fHits.length>=FMAX?'+':''):'Không thấy';
    fcEl.classList.toggle('no',!!q&&!fHits.length);
  }
  function showCur(scroll){
    drawCount();
    if(fCur<0)return;
    var r=mkRange(fHits[fCur]);
    if(hasHL){var one=new Highlight(r);one.priority=1;CSS.highlights.set('find-cur',one)}
    if(scroll){var b=r.getBoundingClientRect(),top=findEl.getBoundingClientRect().bottom+20;
      if(b.top<top||b.bottom>innerHeight-60)window.scrollBy({top:b.top-innerHeight*.4,behavior:'smooth'})}
  }
  /* keep=true: chạy lại sau khi trang được vẽ lại (giữ kết quả đang chọn, không cuộn). */
  function doFind(keep){
    var q=foldMap(fq.value.trim()).s,prev=fCur;
    fHits=[];fCur=-1;clearHL();
    if(!q||!cur){drawCount();return}
    if(!fIdx)fIdx=findIndex();
    var t=fIdx.f.s,map=fIdx.f.map,raw=fIdx.raw,j=0;
    while(fHits.length<FMAX&&(j=t.indexOf(q,j))>=0){
      var s=map[j],e=map[j+q.length-1]+1;
      while(e<raw.length&&raw.charCodeAt(e)>=0x300&&raw.charCodeAt(e)<=0x36f)e++; // kéo theo dấu rời phía sau
      fHits.push([s,e]); j+=q.length;
    }
    if(!fHits.length){drawCount();return}
    if(hasHL){var all=new Highlight();fHits.forEach(function(h){all.add(mkRange(h))});CSS.highlights.set('find',all)}
    if(keep&&prev>=0){fCur=Math.min(prev,fHits.length-1);showCur(false);return}
    // chọn kết quả đầu tiên nằm từ vùng đang xem trở xuống
    var top=findEl.getBoundingClientRect().bottom+10,lo=0,hi=fHits.length;
    while(lo<hi){var m=(lo+hi)>>1;if(mkRange(fHits[m]).getBoundingClientRect().top<top)lo=m+1;else hi=m}
    fCur=lo<fHits.length?lo:0; showCur(true);
  }
  function stepFind(d){
    if(!fHits.length){doFind();return}
    fCur=(fCur+d+fHits.length)%fHits.length; showCur(true);
  }
  function refind(){fIdx=null;if(!findEl.hidden&&cur)doFind(true)}
  function openFind(){
    if(!cur)return; setZen(false);
    findEl.hidden=false; fq.focus(); fq.select();
    if(fq.value.trim())doFind();
  }
  function closeFind(){findEl.hidden=true;fHits=[];fCur=-1;fIdx=null;clearHL();drawCount()}
  fq.addEventListener('input',function(){clearTimeout(fT);fT=setTimeout(function(){doFind()},150)});
  fq.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();clearTimeout(fT);
      if(fCur<0&&fq.value.trim()&&!fHits.length)doFind();else stepFind(e.shiftKey?-1:1)}
  });
  $('fNext').addEventListener('click',function(){stepFind(1)});
  $('fPrev').addEventListener('click',function(){stepFind(-1)});
  $('fClose').addEventListener('click',closeFind);
  $('findBtn').addEventListener('click',function(){findEl.hidden?openFind():closeFind()});

  /* ---------- Xuất tài liệu: HTML / Markdown / In ---------- */
  var exEl=$('ex');
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function closeEx(){exEl.hidden=true;$('exBtn').setAttribute('aria-expanded','false')}
  $('exBtn').addEventListener('click',function(e){
    e.stopPropagation();var o=exEl.hidden;exEl.hidden=!o;this.setAttribute('aria-expanded',String(o));
    if(o){vp.hidden=true;$('vpBtn').setAttribute('aria-expanded','false')}
  });
  document.addEventListener('click',function(e){if(!exEl.hidden&&!exEl.contains(e.target))closeEx()});
  $('exHtml').addEventListener('click',function(){
    closeEx(); if(!cur)return;
    var c=doc.cloneNode(true);
    c.querySelectorAll('.cbh').forEach(function(x){x.remove()});
    c.querySelectorAll('.speaking,.flash').forEach(function(x){x.classList.remove('speaking','flash')});
    var nts=sortedAnns().filter(function(a){return a.txt});
    var foot=nts.length?'<hr><h2>Ghi chú ('+nts.length+')</h2><ol>'+nts.map(function(a){
      return '<li><blockquote>'+esc(annText(a))+'</blockquote><p>'+esc(a.txt).replace(/\n/g,'<br>')+'</p></li>'}).join('')+'</ol>':'';
    var font=document.querySelector('link[rel="stylesheet"]'),css=document.querySelector('style').textContent;
    if(c.querySelector('.katex'))css='@import url("'+KCSS+'");\n'+css;
    var html='<!DOCTYPE html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'+
      '<title>'+esc(cur.name)+'</title>\n'+(font?'<link href="'+esc(font.href)+'" rel="stylesheet">\n':'')+
      '<style>'+css+'\n#doc{display:block}\n</style>\n</head>\n<body>\n<main><div class="sheet"><article id="doc">'+
      c.innerHTML+foot+'</article></div></main>\n</body>\n</html>\n';
    downloadText(cur.name.replace(/\.[^.]*$/,'')+'.html',html,'text/html','Đã xuất bản HTML'+(cur.anns.length?' kèm '+cur.anns.length+' chú thích':''));
  });
  $('exMd').addEventListener('click',function(){
    closeEx(); if(!cur)return;
    var n=/\.(md|markdown)$/i.test(cur.name)?cur.name:cur.name.replace(/\.[^.]*$/,'')+'.md';
    downloadText(n,cur.text,'text/markdown','Đã tải "'+n+'"');
  });
  $('exPrint').addEventListener('click',function(){
    closeEx(); if(!cur)return;
    if(showSource)setMode(false);
    closeFind(); setTimeout(function(){window.print()},50);
  });

  /* ---------- Chế độ tập trung ---------- */
  function setZen(on){
    var was=document.body.classList.contains('zen');
    if(on===was)return;
    document.body.classList.toggle('zen',on);
    if(on){vp.hidden=true;$('vpBtn').setAttribute('aria-expanded','false');closeEx();closeFind();closeLib();
      toast('Chế độ tập trung: nhấn F hoặc Esc để thoát')}
  }
  $('zenBtn').addEventListener('click',function(){setZen(true)});
  $('zenX').addEventListener('click',function(){setZen(false)});

  /* ---------- Bảng phím tắt ---------- */
  var helpEl=$('help');
  function openHelp(){if(helpEl.open)return;if(helpEl.showModal)helpEl.showModal();else helpEl.setAttribute('open','')}
  $('helpBtn').addEventListener('click',openHelp);
  helpEl.addEventListener('click',function(e){if(e.target===helpEl)helpEl.close()}); // bấm ra ngoài để đóng

  /* ---------- Phím tắt ---------- */
  document.addEventListener('keydown',function(e){
    if(helpEl.open)return; // <dialog> tự xử lý Esc
    var k=(e.key||'').toLowerCase();
    if(e.key==='Escape'){
      if(!snEl.hidden){closeNote(true);return}
      if(tb.style.display==='flex'){if(pend)getSelection().removeAllRanges();hideTb();return}
      if(reatt){reatt=null;drawAnnList();toast('Đã hủy gắn lại chú thích');return}
      if(!findEl.hidden){closeFind();return}
      if(document.body.classList.contains('zen')){setZen(false);return}
      vp.hidden=true;$('vpBtn').setAttribute('aria-expanded','false');closeEx();closeLib();return;
    }
    if((e.ctrlKey||e.metaKey)&&!e.altKey&&k==='f'&&cur){e.preventDefault();openFind();return}
    var tg=e.target,typing=tg&&(/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)||tg.isContentEditable);
    if(typing||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='?'){e.preventDefault();openHelp();return}
    if(!cur)return;
    if(e.key==='/'&&!pend){e.preventDefault();openFind();return}
    if(k==='f'&&!pend){e.preventDefault();setZen(!document.body.classList.contains('zen'));return}
    if(showSource)return;
    if(pend){
      if(/^[1-4]$/.test(k)){e.preventDefault();addAnn('hl',COLORS[+k-1][0])}
      else if(k==='u'){e.preventDefault();addAnn('ul')}
      else if(k==='n'){e.preventDefault();addAnn('nt')}
      else if(k==='r'){e.preventDefault();ttsFromSel()}
      return;
    }
    if(k==='t'){e.preventDefault();toggleSide('toc')}
    else if(k==='a'){e.preventDefault();toggleSide('ann')}
  });

  loadAll();
})();