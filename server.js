'use strict';
// NABLA ARENA V3 online server. Private hands are NEVER sent to the opponent.
const http=require('node:http');
const crypto=require('node:crypto');
const Engine=require('./game.js');
const rooms=new Map();
const MAX_ROOMS=500;
const MAX_BYTES=25000;
const ROOM_TTL=6*60*60*1000;
function answer(res,code,data){if(res.writableEnded)return;res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function error(res,code,message){answer(res,code,{error:message});}
function code(){for(let i=0;i<100;i++){let v=String(crypto.randomInt(1e6)).padStart(6,'0');if(!rooms.has(v))return v;}throw Error('部屋番号を確保できません。');}
function token(){return crypto.randomBytes(24).toString('hex');}
function roomOf(data){if(!/^\d{6}$/.test(String(data.code||'')))return null;return rooms.get(String(data.code))||null;}
function authorize(room,data){if(data.token&&data.token===room.tokens[0])return 0;if(data.token&&data.token===room.tokens[1])return 1;return -1;}
function reply(room,seat){return {code:room.code,seat,token:room.tokens[seat],state:Engine.publicView(room.game,seat)};}
function sendUpdates(room){for(const c of [...room.clients]){try{c.res.write('event: state\ndata: '+JSON.stringify(Engine.publicView(room.game,c.seat))+'\n\n');}catch(_){room.clients.delete(c);}}}
function clean(){const now=Date.now();for(const [id,r] of rooms){if(now-r.lastSeen>ROOM_TTL){for(const c of r.clients){try{c.res.end();}catch(_){}}rooms.delete(id);}}}
setInterval(clean,900000).unref();
async function parse(req){return await new Promise((resolve,reject)=>{let body='',bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>MAX_BYTES){reject(Error('送信サイズが上限を超えました。'));req.destroy();return;}body+=b;});req.on('end',()=>{try{let v=body?JSON.parse(body):{};if(!v||typeof v!=='object'||Array.isArray(v))throw Error();resolve(v);}catch(_){reject(Error('データ形式が不正です。'));}});req.on('error',reject);});}
const app=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const url=new URL(req.url||'/', 'http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/api/health')return answer(res,200,{ok:true,app:'NABLA ARENA V3',version:Engine.VERSION,rooms:rooms.size});
    if(req.method==='GET'&&url.pathname==='/api/events'){
      let data=Object.fromEntries(url.searchParams);const room=roomOf(data);if(!room)return error(res,404,'部屋が見つかりません。');
      const seat=authorize(room,data);if(seat===-1)return error(res,403,'参加者認証に失敗しました。');room.lastSeen=Date.now();
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const client={seat,res};room.clients.add(client);res.write('retry: 3000\n\n');
      res.write('event: state\ndata: '+JSON.stringify(Engine.publicView(room.game,seat))+'\n\n');
      const beat=setInterval(()=>{if(!res.writableEnded){try{res.write(': ping\n\n');}catch(_){}}},20000);
      req.on('close',()=>{clearInterval(beat);room.clients.delete(client);});return;
    }
    if(req.method!=='POST'||!url.pathname.startsWith('/api/'))return error(res,404,'APIが見つかりません。');
    const data=await parse(req);
    if(url.pathname==='/api/create'){
      clean();if(rooms.size>=MAX_ROOMS)return error(res,503,'部屋数の上限に達しています。');
      const id=code(),room={code:id,tokens:[token(),null],clients:new Set(),game:Engine.makeGame('online'),lastSeen:Date.now()};rooms.set(id,room);
      return answer(res,200,reply(room,0));
    }
    const room=roomOf(data);if(!room)return error(res,404,'部屋が存在しません。');room.lastSeen=Date.now();
    if(url.pathname==='/api/join'){
      if(room.tokens[1])return error(res,409,'すでに2人参加しています。');
      room.tokens[1]=token();Engine.beginOnline(room.game);sendUpdates(room);
      return answer(res,200,reply(room,1));
    }
    const seat=authorize(room,data);if(seat===-1)return error(res,403,'参加者認証に失敗しました。');
    if(url.pathname==='/api/reconnect')return answer(res,200,reply(room,seat));
    if(url.pathname==='/api/move'){
      const action=data.action;
      if(!action||typeof action!=='object'||!Array.isArray(action.indexes)||action.indexes.length>2||action.indexes.length<1||!Number.isInteger(action.owner)||(action.targetId!==null&&action.targetId!==undefined&&!Number.isInteger(action.targetId)))return error(res,400,'カードの選択形式が不正です。');
      const result=Engine.move(room.game,seat,action);if(result.error)return error(res,400,result.error);
      sendUpdates(room);return answer(res,200,{ok:true});
    }
    if(url.pathname==='/api/rematch'){
      if(room.game.status!=='ended')return error(res,400,'対戦終了後に再戦できます。');
      if(!room.votes)room.votes=[false,false];room.votes[seat]=true;
      if(room.votes.every(Boolean)){
        room.game=Engine.makeGame('online');Engine.beginOnline(room.game);room.votes=[false,false];sendUpdates(room);return answer(res,200,{ok:true,restarted:true});
      }
      return answer(res,200,{ok:true,restarted:false});
    }
    return error(res,404,'APIが見つかりません。');
  }catch(e){console.error(e?.stack||e);if(!res.headersSent&&!res.destroyed)error(res,500,String(e?.message||'サーバーエラー'));}
});
const PORT=Number(process.env.PORT||3000);app.listen(PORT,'0.0.0.0',()=>console.log(`NABLA ARENA V3 server listening on ${PORT}`));
