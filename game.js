/* NABLA ARENA V3 shared rules engine. Works in browser and Node.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NablaEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '3.0.0-beta';
  const MAX_TURNS = 50;
  const CARDS = {
    diff:   { name:'微分',       symbol:'d/dx', type:'single', weight:20, group:'calculus' },
    diff2:  { name:'2階微分',    symbol:'d²/dx²',type:'single',weight:10, group:'calculus' },
    nabla:  { name:'全体微分',   symbol:'∇',    type:'all',    weight:5,  group:'calculus' },
    delta:  { name:'全体2階微分',symbol:'Δ',    type:'all',    weight:3,  group:'calculus' },
    integrate: {name:'積分',     symbol:'∫',    type:'single', weight:15, group:'calculus' },
    integrate2:{name:'2階積分', symbol:'∫∫',   type:'single', weight:10, group:'calculus' },
    intall: {name:'全体積分',   symbol:'∫ 全体',type:'all',   weight:5,  group:'calculus' },
    intall2:{name:'全体2階積分',symbol:'∫∫ 全体',type:'all', weight:3,  group:'calculus' },
    defint: {name:'0～1の定積分',symbol:'∫₀¹',type:'single',weight:10,group:'calculus'},
    mulx:   {name:'xを掛ける',  symbol:'×x', type:'single', weight:10, group:'effect'},
    square: {name:'2乗',       symbol:'f²', type:'single', weight:10, group:'effect'},
    half:   {name:'次数半減',   symbol:'⌊n/2⌋',type:'single',weight:10,group:'effect'},
    zero:   {name:'ゼロ化',     symbol:'×0', type:'single', weight:5, group:'effect'},
    lim0:   {name:'0への極限',  symbol:'lim₀',type:'single',weight:10,group:'effect'},
    liminf: {name:'∞への極限',  symbol:'lim∞',type:'single',weight:10,group:'effect'},
    plus:   {name:'＋（和）',   symbol:'＋', type:'operator',weight:12,group:'operator'},
    minus:  {name:'－（差）',   symbol:'－', type:'operator',weight:12,group:'operator'},
    times:  {name:'×（積）',   symbol:'×', type:'operator',weight:12,group:'operator'},
    add1:   {name:'基底追加：1',symbol:'1',type:'base',weight:5,group:'base'},
    addx:   {name:'基底追加：x',symbol:'x',type:'base',weight:5,group:'base'},
    addx2:  {name:'基底追加：x²',symbol:'x²',type:'base',weight:5,group:'base'},
    addx3:  {name:'基底追加：x³',symbol:'x³',type:'base',weight:5,group:'base'},
    addexp: {name:'基底追加：eˣ',symbol:'eˣ',type:'base',weight:5,group:'base'},
    addsin: {name:'基底追加：sin x',symbol:'sin x',type:'base',weight:5,group:'base'},
    addcos: {name:'基底追加：cos x',symbol:'cos x',type:'base',weight:5,group:'base'},
  };
  const WEIGHT_SUM = Object.values(CARDS).reduce((v,c)=>v+c.weight,0);
  const EPS = 1e-9;
  const err = message => {throw Error(message);};
  const clone = value => JSON.parse(JSON.stringify(value));
  const round = x => Math.abs(x)<EPS?0:Math.round(x*1e10)/1e10;
  function addC(a,b) {let out={...a}; for(const [k,v] of Object.entries(b||{}))out[k]=(out[k]||0)+v; return cleanC(out);}
  function scaleC(a,s) {return cleanC(Object.fromEntries(Object.entries(a||{}).map(([k,v])=>[k,v*s])));}
  function mulC(a,b) {let out={}; for(const [ka,va] of Object.entries(a||{}))for(const [kb,vb] of Object.entries(b||{})){let k=String(Number(ka)+Number(kb));out[k]=(out[k]||0)+va*vb;} return cleanC(out);}
  function cleanC(a) {let o={};for(const [k,v] of Object.entries(a||{})){if(Number.isFinite(v)&&Math.abs(v)>EPS)o[k]=round(v);}return o;}
  function valC(c) {return Object.entries(c).reduce((n,[k,v])=>n+v*Math.exp(Number(k)),0);}
  function emptyC(c) {return !Object.keys(c||{}).length;}
  const cn=(num=1)=>({0:num});
  const term=(n=0,a=0,p=0,q=0,c=cn())=>({n,a,p,q,c});
  const key=t=>[t.n,t.a,t.p,t.q].join(':');
  function normalize(expr) {
    let m=new Map(); for(const t of expr||[]){
      if(!Number.isInteger(t.n)||!Number.isInteger(t.a)||!Number.isInteger(t.p)||!Number.isInteger(t.q)||Math.min(t.n,t.a,t.p,t.q)<0)err('この関数の形式には対応していません。');
      const k=key(t);if(!m.has(k))m.set(k,{n:t.n,a:t.a,p:t.p,q:t.q,c:{}});
      m.get(k).c=addC(m.get(k).c,t.c);
    }
    return [...m.values()].filter(t=>!emptyC(t.c)).sort((a,b)=>termScore(b)-termScore(a)||key(a).localeCompare(key(b)));
  }
  function base(k){const table={add1:term(),addx:term(1),addx2:term(2),addx3:term(3),addexp:term(0,1),addsin:term(0,0,1),addcos:term(0,0,0,1)};return table[k]?[clone(table[k])]:err('基底カードが不正です。');}
  function termScore(t){return t.n + t.a*8 + (t.p+t.q)*4;}
  function productFlag(t){return t.n+t.a+t.p+t.q>1;}
  function score(expr){let s=normalize(expr);return s.reduce((v,t)=>Math.max(v,termScore(t)),0);}
  function hasProduct(expr){return normalize(expr).some(productFlag);}
  function compareExpr(a,b){const diff=score(a)-score(b);if(diff)return Math.sign(diff);return Number(hasProduct(a))-Number(hasProduct(b));}
  function trim(expr){let a=normalize(expr); if(a.length<=3)return {out:a,removed:[]};
    a.sort((x,y)=>termScore(y)-termScore(x)||Number(productFlag(y))-Number(productFlag(x))||key(x).localeCompare(key(y)));
    return {out:normalize(a.slice(0,3)),removed:a.slice(3)};
  }
  function addExpr(a,b,s=1){return normalize([...a,...b.map(t=>({...t,c:scaleC(t.c,s)}))]);}
  function mulExpr(a,b){if(a.length*b.length>3000)err('式が大きすぎるため、この演算は使用できません。');let out=[];
    for(const x of a)for(const y of b){if(x.n+y.n>30||x.a+y.a>16||x.p+y.p+x.q+y.q>12)err('式の複雑さが上限を超えます。');out.push(term(x.n+y.n,x.a+y.a,x.p+y.p,x.q+y.q,mulC(x.c,y.c)));}
    return normalize(out);
  }
  function derive(a){const out=[];for(const t of a){const {n,a:ex,p,q,c}=t;
    if(n)out.push(term(n-1,ex,p,q,scaleC(c,n)));
    if(ex)out.push(term(n,ex,p,q,scaleC(c,ex)));
    if(p)out.push(term(n,ex,p-1,q+1,scaleC(c,p)));
    if(q)out.push(term(n,ex,p+1,q-1,scaleC(c,-q)));
  }return normalize(out);}
  function complex(re=0,im=0){return {re,im};}
  function cplus(u,v){return complex(u.re+v.re,u.im+v.im);}
  function cmul(u,v){return complex(u.re*v.re-u.im*v.im,u.re*v.im+u.im*v.re);}
  function cdiv(u,v){let d=v.re*v.re+v.im*v.im;return complex((u.re*v.re+u.im*v.im)/d,(u.im*v.re-u.re*v.im)/d);}
  function cscale(u,k){return complex(u.re*k,u.im*k);}
  function cpowRecip(re,im,j){let z=complex(1,0),base=cdiv(complex(1,0),complex(re,im));for(let i=0;i<j;i++)z=cmul(z,base);return z;}
  function binom(n,k){let r=1;for(let j=1;j<=k;j++)r=r*(n-j+1)/j;return r;}
  function trigToFourier(p,q){let modes=new Map([[0,complex(1,0)]]);
    function times(factors){let next=new Map();for(const [a,u] of modes)for(const [b,v] of factors){let k=a+b;next.set(k,cplus(next.get(k)||complex(),cmul(u,v)));}modes=next;}
    for(let i=0;i<p;i++)times([[1,complex(0,-.5)],[-1,complex(0,.5)]]);
    for(let i=0;i<q;i++)times([[1,complex(.5,0)],[-1,complex(.5,0)]]);
    return modes;
  }
  function writeHarmonic(out,n,a,k,kind,coeff){
    if(Math.abs(coeff)<EPS)return;
    if(k===0){out.push(term(n,a,0,0,cn(coeff)));return;}
    for(let j=0;j<=k;j++){
      if((kind==='cos' && j%2)||(kind==='sin'&&j%2===0))continue;
      let sign=(((kind==='cos'?j:j-1)/2)%2===0)?1:-1;
      let factor=coeff*binom(k,j)*sign;
      if(Math.abs(factor)>EPS)out.push(term(n,a,j,k-j,cn(factor)));
    }
  }
  function integrate(a){let out=[];const expr=normalize(a);
    if(expr.length>16)err('複雑な積分には対応していません。');
    for(const t of expr){
      if(t.n>8||t.a>8||t.p+t.q>6)err('この関数の積分は計算範囲を超えます。');
      const modes=trigToFourier(t.p,t.q);
      for(const [k,coef] of modes){
        // Only nonnegative Fourier frequencies are needed for a real integrand.
        if(k<0)continue;
        if(Math.abs(coef.re)+Math.abs(coef.im)<EPS)continue;
        if(k===0&&t.a===0){
          if(Math.abs(coef.im)>EPS)err('積分の数式処理で誤差が発生しました。');
          out.push(term(t.n+1,0,0,0,scaleC(t.c,coef.re/(t.n+1))));continue;
        }
        let factor=1;
        for(let j=0;j<=t.n;j++){
          if(j>0)factor*=-1*(t.n-j+1);
          const coeff=cmul(cscale(coef,factor),cpowRecip(t.a,k,j+1));
          if(k===0)out.push(term(t.n-j,t.a,0,0,scaleC(t.c,coeff.re)));
          else{
            // z^k and z^-k form a real pair: 2(Re(c)cos(kx) - Im(c)sin(kx)).
            let cc=[],ss=[];
            writeHarmonic(cc,t.n-j,t.a,k,'cos',2*coeff.re);
            writeHarmonic(ss,t.n-j,t.a,k,'sin',-2*coeff.im);
            for(const v of [...cc,...ss])out.push({...v,c:mulC(v.c,t.c)});
          }
        }
      }
    }
    if(out.length>3000)err('この積分の展開結果は複雑すぎます。');
    return normalize(out);
  }
  function evalEndpoint(expr,at){let c={};for(const t of expr){
    if(t.p||t.q)err('この定積分の評価形式には対応していません。');
    if(at===0 && t.n>0)continue;
    let factor=at===1?{[t.a]:1}:cn();
    c=addC(c,mulC(t.c,factor));
  }return c;}
  function definite(expr){
    if(expr.some(t=>t.p||t.q))return {expr:[term()],message:'三角関数を含むため、ゲーム特別ルールで結果を1にします。'};
    const antiderivative=integrate(expr);
    return {expr:normalize([term(0,0,0,0,addC(evalEndpoint(antiderivative,1),scaleC(evalEndpoint(antiderivative,0),-1)))]),
      message:`原始関数 F(x) = ${exprText(antiderivative)} を求め、F(1)−F(0)を厳密計算しました。`};
  }
  function limitZero(expr){let c={};for(const t of expr){if(t.n>0||t.p>0)continue;c=addC(c,t.c);}return normalize([term(0,0,0,0,c)]);}
  function limitInf(expr){const list=normalize(expr);if(!list.length)return [];
    const growing=list.filter(t=>t.a>0||t.n>0);
    if(growing.length){
      growing.sort((a,b)=>b.a-a.a||b.n-a.n);
      const high=growing[0];
      if(growing.some(t=>t.a===high.a&&t.n===high.n&&(t.p||t.q)))err('正負に振動して極限が存在しないため使用できません。');
      if(high.p||high.q)err('振動して極限が存在しないため使用できません。');
      if(Math.abs(valC(high.c))<EPS)err('極限の符号を正確に判定できません。');
      return []; // +∞ or -∞ both become 0 by game rule.
    }
    if(list.some(t=>t.p||t.q))err('振動して極限が存在しないため使用できません。');
    return normalize(list);
  }
  function step(k,expr){const a=normalize(expr);
    if(k==='diff'||k==='nabla')return {out:derive(a), note:'べき・指数・三角関数の微分法と積の微分法を適用'};
    if(k==='diff2'||k==='delta'){
      const first=derive(a);return {out:derive(first),note:`1階微分：${exprText(first)}。続けてもう1回微分。`};
    }
    if(k==='integrate'||k==='intall')return {out:integrate(a),note:'多項式は累乗公式、積は部分積分・三角恒等式を利用（積分定数C=0）'};
    if(k==='integrate2'||k==='intall2'){
      const first=integrate(a);return {out:integrate(first),note:`1回目の積分：${exprText(first)}。続けてもう1回積分（C=0）。`};
    }
    if(k==='defint'){let d=definite(a);return {out:d.expr,note:d.message};}
    if(k==='mulx')return {out:mulExpr(a,[term(1)]),note:'xを掛ける'};
    if(k==='square')return {out:mulExpr(a,a),note:'関数全体を2乗'};
    if(k==='zero')return {out:[],note:'ゼロ化'};
    if(k==='half'){
      if(a.length!==1||a[0].a||a[0].p||a[0].q||a[0].n<1)err('次数半減は、正の整数次数の単項式にのみ使用できます。');
      return {out:[term(Math.floor(a[0].n/2),0,0,0,a[0].c)],note:'次数を半分にし、小数点以下を切り捨て'};
    }
    if(k==='lim0')return {out:limitZero(a),note:'x→0 の極限'};
    if(k==='liminf')return {out:limitInf(a),note:'x→+∞ の極限。正負の無限大への発散はゲーム上0'};
    err('使用できないカードです。');
  }
  function rationalText(x){x=round(x);if(!x)return '0';if(Number.isInteger(x))return String(x);
    for(let d=1;d<=360;d++){let n=Math.round(x*d);if(Math.abs(x-n/d)<1e-8){let g=gcd(Math.abs(n),d);n/=g;let den=d/g;return den===1?String(n):`${n}/${den}`;}}
    return String(Number(x.toPrecision(7)));
  }
  function gcd(a,b){while(b){let t=a%b;a=b;b=t;}return a||1;}
  function coefficientText(c){let entries=Object.entries(cleanC(c)).sort((a,b)=>Number(b[0])-Number(a[0]));
    if(!entries.length)return '0';let text='';
    for(const [kstr,value] of entries){let k=Number(kstr),neg=value<0,abs=Math.abs(value);
      let coeff=rationalText(abs),v=k===0?coeff:(coeff==='1'?'':coeff+'·')+(k===1?'e':`e^${k}`);
      text += (text?(neg?' - ':' + '):(neg?'-':''))+v;
    }return text;
  }
  function monomialText(t){let bits=[];
    if(t.a)bits.push(t.a===1?'e^x':`e^(${t.a}x)`);
    if(t.n)bits.push(t.n===1?'x':`x^${t.n}`);
    if(t.p)bits.push(t.p===1?'sin x':`sin^${t.p} x`);
    if(t.q)bits.push(t.q===1?'cos x':`cos^${t.q} x`);
    return bits.join('·')||'1';
  }
  function prettyTerm(t){let fac=monomialText(t),c=coefficientText(t.c),pure=fac==='1';
    if(pure)return c;if(c==='1')return fac;if(c==='-1')return '-'+fac;
    let complexCoeff=c.includes(' + ')||c.includes(' - ');return (complexCoeff?'('+c+')':c)+'·'+fac;
  }
  function exprText(expr){const list=normalize(expr);if(!list.length)return '0';
    return list.map((t,i)=>{let v=prettyTerm(t);return i?((v.startsWith('-')? ' - '+v.slice(1) :' + '+v)):v;}).join('');
  }
  // For game-specific equivalence, ignore all nonzero coefficient sizes, signs, and an added constant.
  function equivalence(expr){const a=normalize(expr).filter(t=>!(t.n===0&&t.a===0&&t.p===0&&t.q===0));
    return a.length?a.map(t=>key(t)).sort().join('|'):(normalize(expr).length?'CONST':'ZERO');
  }
  // Linear independence under the game's canonical rule: ignore nonzero coefficient
  // sizes, coefficient signs, and constants appended to nonconstant functions.
  // Choose the strongest independent set so dependent cards are not double-counted.
  function canonicalVector(expr){
    const a=normalize(expr),nonconstant=a.filter(t=>t.n||t.a||t.p||t.q);
    const use=nonconstant.length?nonconstant:a;
    return Object.fromEntries(use.map(t=>[key(t),1]));
  }
  function independentCards(board){
    const active=board.filter(b=>b.expr.length).sort((a,b)=>compareExpr(b.expr,a.expr)||a.id-b.id);
    const pivots=new Map(),selected=[];
    for(const b of active){
      const row=canonicalVector(b.expr);
      for(const [pivot,basis] of pivots){
        let fac=row[pivot]||0;if(Math.abs(fac)<1e-8)continue;
        for(const [k,v] of Object.entries(basis))row[k]=(row[k]||0)-fac*v;
      }
      const pivot=Object.keys(row).sort().find(k=>Math.abs(row[k])>1e-8);
      if(pivot===undefined)continue;
      let f=row[pivot];for(const k of Object.keys(row))row[k]/=f;
      pivots.set(pivot,row);selected.push(b);
    }
    return selected;
  }
  function boardScore(board){return independentCards(board).reduce((sum,b)=>sum+score(b.expr),0);}
  function draw(random=Math.random){let r=random()*WEIGHT_SUM;for(const [id,c] of Object.entries(CARDS)){r-=c.weight;if(r<0)return id;}return 'diff';}
  function cardNames(ids){return ids.map(id=>CARDS[id]?.name||id).join(' ＋ ');}
  function makeGame(mode='cpu',difficulty='standard'){
    const starter=()=>[base('add1'),base('addx'),base('addx2')].map((expr,i)=>({id:i+1,expr}));
    const g={version:VERSION,mode,difficulty,status:mode==='online'?'waiting':'playing',
      boards:[starter(),starter()],hands:[[],[]],turn:0,turnCount:0,serial:4,logs:[],last:null,winner:null};
    for(let seat=0;seat<2;seat++)for(let i=0;i<7;i++)g.hands[seat].push(draw());
    if(g.status==='playing')ensure(g);return g;
  }
  function log(g,seat,used,owner,before,after,note,removed,more){
    const item={turn:g.turnCount+1,seat,used,owner,before,after,note,removed:removed||[],more:more||'',at:Date.now()};
    g.logs.push(item);if(g.logs.length>80)g.logs.shift();g.last=item;
  }
  function tryAction(g,seat,action){
    try{
      if(g.status!=='playing')err('対戦が開始されていません。');
      if(seat!==g.turn)err('相手のターンです。');
      const indexes=action?.indexes;
      if(!Array.isArray(indexes)||indexes.length<1||indexes.length>2||!indexes.every(n=>Number.isInteger(n)&&n>=0&&n<g.hands[seat].length)||new Set(indexes).size!==indexes.length)err('手札の指定が不正です。');
      const ids=indexes.map(i=>g.hands[seat][i]);const types=ids.map(k=>CARDS[k]?.type);
      if(!types.every(Boolean))err('存在しないカードです。');
      let k=ids[0],single=ids.length===1,pair=false,operand=null;
      if(!single){if(types.includes('operator')&&types.includes('base')){pair=true;k=ids[types.indexOf('operator')];operand=ids[types.indexOf('base')];}else err('2枚使用できるのは演算記号＋基底カードだけです。');}
      if(single&&types[0]==='operator')err('演算記号は基底カードとの2枚組で使用してください。');
      const owner=action.owner,tid=action.targetId;
      if(owner!==0&&owner!==1)err('対象プレイヤーが不正です。');
      const boards=clone(g.boards);
      let changes=[],removed=[];
      function update(card,item){let before=exprText(item.expr);let st=step(card,item.expr);
        const limited=trim(st.out);let after=exprText(limited.out);
        if(before===after)err('関数が変わらない操作は使用できません。');
        item.expr=limited.out;changes.push(`${before} → ${after}（${st.note}）`);
        for(const t of limited.removed)removed.push(prettyTerm(t));
      }
      const type=CARDS[k].type;
      if(single&&type==='base'){
        let expr=base(k);
        const beforeRank=independentCards(boards[owner]).length;
        if(independentCards([...boards[owner],{id:g.serial,expr}]).length===beforeRank)err('既存の基底と線形従属になるため、追加できません。');
        boards[owner].push({id:g.serial,expr});changes.push(`基底 ${exprText(expr)} を追加`);
      }else if(single&&type==='all'){
        let active=boards[owner].filter(b=>b.expr.length);if(!active.length)err('対象の盤面に作用できる関数がありません。');
        for(const item of active)update(k,item);
      }else{
        const item=boards[owner].find(b=>b.id===tid);if(!item)err('対象の関数を選んでください。');
        if(pair){const v=base(operand);let next=k==='plus'?addExpr(item.expr,v):k==='minus'?addExpr(item.expr,v,-1):mulExpr(item.expr,v);
          const limited=trim(next);const before=exprText(item.expr);const after=exprText(limited.out);
          if(before===after)err('関数が変わらない操作は使用できません。');
          item.expr=limited.out;changes.push(`${before} → ${after}（${CARDS[k].name}と${CARDS[operand].name}）`);
          for(const t of limited.removed)removed.push(prettyTerm(t));
        }else update(k,item);
      }
      if(!changes.length)err('有効な操作がありません。');
      return {ok:true,boards,changes,removed,ids,owner,serialIncrease:single&&type==='base'?1:0};
    }catch(e){return {error:String(e.message||e)};}
  }
  function legalActions(g,seat,limit=2500){if(g.status!=='playing'||g.turn!==seat)return [];
    let ans=[],hand=g.hands[seat];
    const attempt=a=>{if(ans.length>=limit)return; if(tryAction(g,seat,a).ok)ans.push(a);};
    for(let i=0;i<hand.length;i++){
      let c=CARDS[hand[i]];
      if(c.type==='operator')continue;
      for(let owner=0;owner<2;owner++){
        if(c.type==='base'||c.type==='all')attempt({indexes:[i],owner,targetId:null});
        else for(let b of g.boards[owner])attempt({indexes:[i],owner,targetId:b.id});
      }
    }
    const opIndexes=hand.map((k,i)=>CARDS[k].type==='operator'?i:-1).filter(i=>i>=0);
    const bIndexes=hand.map((k,i)=>CARDS[k].type==='base'?i:-1).filter(i=>i>=0);
    for(const i of opIndexes)for(const j of bIndexes)for(let owner=0;owner<2;owner++)for(const b of g.boards[owner])attempt({indexes:[i,j],owner,targetId:b.id});
    return ans;
  }
  function ensure(g){let guard=0;while(g.status==='playing'&&!legalActions(g,g.turn,1).length&&guard++<100){
      let seat=g.turn,drawn=0;
      while(drawn<3&&!legalActions(g,seat,1).length){g.hands[seat].push(draw());drawn++;}
      const note=legalActions(g,seat,1).length?`有効なカードがないため${drawn}枚ドローしました。`:`${drawn}枚ドローしても使用できないためパス。`;
      log(g,seat,[],null,'','',note,[],'');
      if(legalActions(g,seat,1).length)break;
      g.turnCount++;finish(g);if(g.status==='ended')break;g.turn=1-g.turn;
    }
  }
  function finish(g){
    if(g.status==='ended')return;
    const dead=owner=>g.boards[owner].length>0&&g.boards[owner].every(b=>!b.expr.length);
    if(dead(0)||dead(1)){
      g.status='ended';g.winner=dead(0)&&dead(1)?'draw':dead(0)?1:0;
      g.finishReason='盤面のすべての関数が0';return;
    }
    if(g.turnCount>=MAX_TURNS){
      let a=boardScore(g.boards[0]),b=boardScore(g.boards[1]);g.winner=a===b?'draw':a>b?0:1;
      g.status='ended';g.finishReason='50ターン終了：関数強度の合計';
    }
  }
  function move(g,seat,action){const trial=tryAction(g,seat,action);if(trial.error)return trial;
    const before=boardScore(g.boards[seat]);
    g.boards=trial.boards;g.serial+=trial.serialIncrease;
    let hand=g.hands[seat];for(const i of [...action.indexes].sort((a,b)=>b-a))hand.splice(i,1);
    for(let i=0;i<action.indexes.length;i++)hand.push(draw());
    log(g,seat,trial.ids,trial.owner,trial.changes.map(x=>x.split(' → ')[0]).join(' / '),trial.changes.join('\n'),
      trial.ids.map(id=>CARDS[id].name).join(' ＋ '),trial.removed,`自分の場の強度 ${before} → ${boardScore(g.boards[seat])}`);
    g.turnCount++;finish(g);
    if(g.status==='playing'){g.turn=1-seat;ensure(g);}
    return {ok:true};
  }
  function beginOnline(g){if(g.status!=='waiting')return;g.status='playing';ensure(g);}
  function publicView(g,seat){return {
    version:VERSION,mode:g.mode,status:g.status,winner:g.winner,finishReason:g.finishReason||'',
    turn:g.turn,turnCount:g.turnCount,maxTurns:MAX_TURNS,seat,
    boards:clone(g.boards),hand:clone(g.hands[seat]),handCounts:g.hands.map(h=>h.length),
    scores:g.boards.map(boardScore),logs:clone(g.logs),last:clone(g.last),
  };}
  function cpuMove(g){if(g.status!=='playing'||g.turn!==1)return null;
    let actions=legalActions(g,1,1500);if(!actions.length){ensure(g);return null;}
    if(g.difficulty==='easy')return move(g,1,actions[Math.floor(Math.random()*actions.length)]);
    let best=[],max=-Infinity;
    for(const a of actions){const t=tryAction(g,1,a);if(!t.ok)continue;
      const you=boardScore(t.boards[1]),opp=boardScore(t.boards[0]);
      const kill=t.boards[0].every(b=>!b.expr.length)?100000:0;
      const s=you-opp+kill+(Math.random()*(g.difficulty==='hard'?0.3:4));
      if(s>max+1e-8){max=s;best=[a];}else if(Math.abs(s-max)<1e-8)best.push(a);
    }
    return move(g,1,best[0]||actions[0]);
  }
  return {VERSION,CARDS,WEIGHT_SUM,makeGame,beginOnline,move,cpuMove,publicView,legalActions,
    tryAction,score,boardScore,exprText,equivalence,normalize,base,term,step,integrate,trim,compareExpr};
});
