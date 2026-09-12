import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { SEBASTIAN_WEB_SCRIPT } from '../../application/SebastianWebInterface.js';

class Element {
  value='';disabled=false;checked=true;textContent='';className='';id='';innerHTML='';scrollTop=0;scrollHeight=0;
  style: Record<string,unknown>={};dataset:Record<string,unknown>={};children:Element[]=[];
  classList={add:()=>{},remove:()=>{}};
  events:Record<string,(event: {preventDefault():void;key?:string;shiftKey?:boolean})=>unknown>={};
  append(...children:Element[]){this.children.push(...children);}
  setAttribute(){} removeAttribute(){} focus(){} remove(){}
  addEventListener(name:string,fn:Element['events'][string]){this.events[name]=fn;}
  querySelector(){return new Element();}
}
const settle=async()=>{for(let i=0;i<15;i++) await new Promise<void>(resolve=>setImmediate(resolve));};
function harness(url='http://localhost/',script=SEBASTIAN_WEB_SCRIPT) {
  const elements=new Map<string,Element>();const calls:Array<{url:string;method:string;body?:string}>=[];
  let location=new URL(url), sequence=0, authenticated=true, failCreate=false, failOpen=false;
  const get=(key:string)=>{if(!elements.has(key))elements.set(key,new Element());return elements.get(key)!;};
  const fetch=async(url:string,init:{method?:string;body?:string}={})=>{
    const method=init.method??'GET';calls.push({url,method,...(init.body?{body:init.body}:{})});
    let ok=true,data:unknown={};
    if(url==='/api/web/session') data={authenticated};
    else if(url==='/api/web/conversations'&&method==='POST'){ok=!failCreate;data={conversation:{id:'conversation-new-'+(++sequence)}};}
    else if(url==='/api/web/conversations')data={conversations:[]};
    else if(url.startsWith('/api/web/conversations/')){ok=!failOpen;data={messages:[],project:null};}
    else if(url==='/api/web/converse')data={message:'ok'};
    return {ok,status:ok?200:503,json:async()=>data};
  };
  const win={get location(){return {href:location.href,search:location.search};},history:{replaceState:(_a:unknown,_b:unknown,next:URL)=>{location=new URL(next);}}};
  runInNewContext(script,{document:{querySelector:get,createElement:()=>new Element()},window:win,URL,URLSearchParams,fetch,console});
  return {get,calls,location:()=>location,failCreate:()=>{failCreate=true;},failOpen:()=>{failOpen=true;},logout:()=>{authenticated=false;},click:async(key:string,event='click')=>{await get(key).events[event]?.({preventDefault(){}});await settle();}};
}
test('clean URL creates new, refresh and browser-restored ?c reopen the same identity',async()=>{
  const clean=harness();await settle();assert.equal(clean.calls.filter(c=>c.method==='POST').length,1);
  const id=clean.location().searchParams.get('c');assert.ok(id);
  for(let i=0;i<2;i++){const restored=harness('http://localhost/?c='+id);await settle();assert.ok(restored.calls.some(c=>c.url.endsWith('/'+id)));assert.equal(restored.calls.filter(c=>c.method==='POST').length,0);}
});
test('login and new-conversation action start distinct identities',async()=>{
  const h=harness('http://localhost/?c=conversation-old');await settle();
  h.get('#access-token').value='test';await h.click('#unlock-form','submit');
  const first=h.location().searchParams.get('c');assert.notEqual(first,'conversation-old');
  await h.click('#new-conversation-button');assert.notEqual(h.location().searchParams.get('c'),first);
});
test('failed create cannot silently submit to previous conversation and exposes recovery',async()=>{
  const h=harness('http://localhost/?c=conversation-old');await settle();h.failCreate();await h.click('#new-conversation-button');
  h.get('#message-input').value='must not reach old';await h.click('#composer-form','submit');
  assert.equal(h.calls.filter(c=>c.url==='/api/web/converse').length,0);
  assert.equal(h.location().searchParams.get('c'),null);assert.equal(h.get('#message-input').disabled,true);
  assert.ok(JSON.stringify(h.get('#messages').children).includes('Não foi possível criar'));
});
test('reopen failure does not create replacement conversation or permit sending into another identity',async()=>{
  // fetch is async; failure is configured before its resolved response is consumed.
  const h=harness('http://localhost/?c=conversation-missing');h.failOpen();await settle();
  assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
  assert.equal(h.get('#message-input').disabled,true);
});
