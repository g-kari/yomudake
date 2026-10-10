import http from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createWorker} from '../../dist/worker.js';
const root=new URL('../../',import.meta.url);
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('migrations/0001_articles.sql',root),'utf8'));
const articles=[
 ['3a68fb6a-c5f0-4842-93d8-13d09541d05c','余白をつくる、小さな習慣','# 余白をつくる、小さな習慣\n\n朝の10分を、何もしない時間にする。\n小さな余白が、その日の見え方を変えてくれる。\n\n## 机を整える\n\n目に入るものを少し減らす。\n大切なものが自然に見つかる。'],
 ['d9046823-6e12-43d9-bacf-6c5d9b047a97','散歩で見つける色','# 散歩で見つける色\n\n今日は青と黄色を見つけた。'],
 ['0dde42b8-355d-4c85-8cd8-a34534a97eb6','夜の読書ノート','# 夜の読書ノート\n\n明日のための、小さな読書。']
];
for(const [i,[id,title,markdown]] of articles.entries())db.prepare('INSERT INTO articles (id,title,source_url,markdown,published,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?)').run(id,title,'https://example.org/note',markdown,0,`2026-10-0${9-i}T10:24:00Z`,`2026-10-0${9-i}T10:24:00Z`,null);
function prepare(sql,args=[]){return {bind(...a){return prepare(sql,a)},async all(){return {success:true,results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){db.prepare(sql).run(...args);return {success:true}}};}
const env={DB:{prepare},ASSETS:{async fetch(req){const path=new URL(req.url).pathname;const types={'.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'};return new Response(readFileSync(new URL('public'+path,root)),{headers:{'Content-Type':types[path.slice(path.lastIndexOf('.'))]||'application/octet-stream'}});}}};
// Isolated loopback fixture. It has no production credentials, AI calls or D1 connection.
const worker=createWorker({verifyOwner:async()=>({ok:true,status:200}),convert:async url=>({title:'変換した架空記事',sourceUrl:url,markdown:'# 変換した架空記事\n\nこれはブラウザー検証用の合成本文です。'})});
export const server=http.createServer(async(req,res)=>{try{
 const body=[];for await(const chunk of req)body.push(chunk);
 const request=new Request('http://127.0.0.1:4179'+req.url,{method:req.method,headers:req.headers,...(body.length?{body:Buffer.concat(body)}:{})});
 const result=await worker.fetch(request,env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
}catch(e){res.writeHead(500);res.end(String(e));}});
export const ready=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4179,'127.0.0.1',resolve);});
export const close=()=>new Promise(resolve=>server.close(()=>{db.close();resolve();}));
