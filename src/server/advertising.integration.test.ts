import { mkdtemp, rm, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApplication, type AppConfig } from './app';
import { hashToken } from './security';
import { RoomStore } from './rooms';
import { GAME_IDS } from '../games/catalog';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const keys={roomCode:'free-fixture-code-12345',testRoomCode:'test-fixture-code-12345',roomVipCode:'vip-fixture'};
const ads={client:'ca-pub-1234567890123456',slot:'1234567890'};
const headers=(seat:any)=>({Authorization:`Bearer ${seat.credentials}`,...(seat.observerID?{'X-Observer-ID':seat.observerID}:{'X-Player-ID':seat.playerID})});
async function fixture(withPages=false, overrides:Partial<AppConfig>={}){
  const root=await mkdtemp(join(tmpdir(),'boardgame-advertising-'));
  cleanups.push(async()=>{if(dirname(resolve(root))!==resolve(tmpdir())||!basename(root).startsWith('boardgame-advertising-'))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});});
  const clientDir=join(root,'client');
  if(withPages){await mkdir(clientDir);await copyFile('index.html',join(clientDir,'index.html'));await copyFile('privacy.html',join(clientDir,'privacy.html'));await copyFile('public/privacy.css',join(clientDir,'privacy.css'));}
  const config={...keys,adsense:ads,dataDir:join(root,'data'),publicOrigin:'https://boardgame.example.com',host:'127.0.0.1',port:0,production:true,privacyContact:'privacy@example.com',...(withPages?{clientDir}:{}),lifecycleSweepMs:60000,...overrides};
  let app=await createApplication(config), running=await app.listen();
  cleanups.push(()=>running.close());
  const request=async(path:string,body?:any,seat?:any,method?:string)=>{
    const response=await fetch(`http://127.0.0.1:${running.port}${path}`,{method:method??(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(seat?headers(seat):{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,headers:response.headers,body:data};
  };
  return {request,get app(){return app;},async restart(changes:Partial<AppConfig>={}){await running.close();Object.assign(config,changes);app=await createApplication(config);running=await app.listen();}};
}
describe('Authenticated room-wide advertising',()=>{
  it.each(GAME_IDS)('%s uses the same four server-side room policies',async(gameId)=>{
    const f=await fixture();
    for(const [roomCode,enabled,testRoom] of [[undefined,true,false],[keys.roomCode,false,false],[keys.testRoomCode,false,true],[keys.roomVipCode,false,false]] as const){
      const created=await f.request('/api/rooms',{displayName:'Host',gameId,roomCode});
      expect(created.status).toBe(201);expect(created.body).toMatchObject({gameName:gameId,testRoom,advertising:{enabled}});
    }
  });
  it.each([
    [undefined,true,false],[keys.roomCode,false,false],[keys.testRoomCode,false,true],
  ] as const)('applies server-selected policy to every member and persists it across restart (ads %s)',async(key,enabled,testRoom)=>{
    const f=await fixture();
    const created=await f.request('/api/rooms',{displayName:'Host',gameId:'encrypted-call',roomCode:key,adsMode:enabled?'adfree':'standard',testRoom:!testRoom});
    expect(created.status).toBe(201);const host=created.body;
    const token=new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite');
    const guest=(await f.request(`/api/rooms/${host.roomId}/join`,{displayName:'Guest',inviteToken:token})).body;
    const observer=(await f.request(`/api/rooms/${host.roomId}/watch`,{displayName:'Observer',inviteToken:token})).body;
    for(const value of [host,guest,observer]){expect(value.testRoom).toBe(testRoom);expect(value.advertising).toEqual(enabled?{enabled:true,...ads}:{enabled:false});}
    for(const seat of [host,guest])expect((await f.request(`/api/rooms/${host.roomId}/ready`,{ready:true},seat)).status).toBe(200);
    expect((await f.request(`/api/rooms/${host.roomId}/start`,{matchID:host.matchID},host)).status).toBe(200);
    await f.restart();
    for(const seat of [host,guest,observer]){
      const info=await f.request(`/api/rooms/${host.roomId}`,undefined,seat);
      expect(info.status).toBe(200);expect(info.body.advertising.enabled).toBe(enabled);expect(info.body.testRoom).toBe(testRoom);
      for(const secret of Object.values(keys))expect(JSON.stringify(info.body)).not.toContain(secret);
    }
    const returned=await f.request(`/api/rooms/${host.roomId}/abort`,{matchID:host.matchID},host);
    expect(returned.status).toBe(200);expect(returned.body.advertising.enabled).toBe(enabled);
    const changed=await f.request(`/api/rooms/${host.roomId}/game`,{matchID:returned.body.matchID,gameId:'turing-test'},host);
    expect(changed.status).toBe(200);expect(changed.body.advertising.enabled).toBe(enabled);
  });
  it.each(GAME_IDS)('%s keeps the VIP creator adfree while guests and spectators receive display ads without vignettes',async(gameId)=>{
    const f=await fixture();
    const created=await f.request('/api/rooms',{displayName:'VIP creator',gameId,roomCode:keys.roomVipCode,
      vipCreatorCredentialHash:'forged',vipCreatorPlayerID:'1',adsMode:'standard'});
    expect(created.status).toBe(201);const host=created.body;
    expect(host.testRoom).toBe(false);expect(host.advertising).toEqual({enabled:false});
    const inviteToken=new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite');
    // Even a supplied creator Authorization header cannot give the new admission its benefit.
    const guest=(await f.request(`/api/rooms/${host.roomId}/join`,{displayName:'Guest',inviteToken},host)).body;
    const observer=(await f.request(`/api/rooms/${host.roomId}/watch`,{displayName:'Observer',inviteToken})).body;
    const display={enabled:true,...ads,vignette:false};
    for(const seat of [guest,observer])expect(seat.advertising).toEqual(display);
    for(const seat of [host,guest,observer]){
      const response=await f.request(`/api/rooms/${host.roomId}`,undefined,seat);
      expect(response.status).toBe(200);expect(response.body.advertising).toEqual(seat===host?{enabled:false}:display);
      const text=JSON.stringify(response.body);
      expect(text).not.toContain('vipCreatorCredentialHash');expect(text).not.toContain(hashToken(host.credentials));
      for(const code of Object.values(keys))expect(text).not.toContain(code);
    }
    expect((await f.request(`/api/rooms/${host.roomId}`,undefined,{...guest,playerID:host.playerID})).status).toBe(401);
  });
  it('preserves VIP identity through start, abort, game changes, role-switch retries and restart without transferring the benefit',async()=>{
    const f=await fixture();
    const created=await f.request('/api/rooms',{displayName:'VIP creator',gameId:'encrypted-call',roomCode:keys.roomVipCode});
    let host=created.body;
    const inviteToken=new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite');
    const guest=(await f.request(`/api/rooms/${host.roomId}/join`,{displayName:'Guest',inviteToken})).body;
    const path=(operation='')=>`/api/rooms/${host.roomId}${operation?'/'+operation:''}`;
    const display={enabled:true,...ads,vignette:false};
    for(const seat of [host,guest])expect((await f.request(path('ready'),{ready:true,matchID:host.matchID},seat)).status).toBe(200);
    const started=await f.request(path('start'),{matchID:host.matchID},host);
    expect(started.status).toBe(200);expect(started.body.advertising).toEqual({enabled:false});
    await f.restart();
    expect((await f.request(path(),undefined,host)).body.advertising).toEqual({enabled:false});
    expect((await f.request(path(),undefined,guest)).body.advertising).toEqual(display);
    const returned=await f.request(path('abort'),{matchID:host.matchID},host);
    expect(returned.status).toBe(200);expect(returned.body.advertising).toEqual({enabled:false});
    const changed=await f.request(path('game'),{matchID:returned.body.matchID,gameId:'space-station'},host);
    expect(changed.status).toBe(200);expect(changed.body.advertising).toEqual({enabled:false});
    const oldHost=host;
    const switchBody={matchID:changed.body.matchID,access:'spectator',requestID:randomUUID()};
    const switched=await f.request(path('switch-role'),switchBody,host);
    expect(switched.status).toBe(200);host=switched.body;
    expect(host.advertising).toEqual({enabled:false});
    const retry=await f.request(path('switch-role'),switchBody,oldHost);
    expect(retry.status).toBe(200);expect(retry.body.advertising).toEqual({enabled:false});
    expect(retry.body.credentials).toBe(host.credentials);
    expect((await f.request(path(),undefined,oldHost)).status).toBe(401);
    const replacement=(await f.request(path('join'),{displayName:'Replacement',inviteToken})).body;
    expect(replacement.playerID).toBe(oldHost.playerID);expect(replacement.advertising).toEqual(display);
    await f.restart({roomVipCode:''});
    expect((await f.request(path(),undefined,host)).body.advertising).toEqual({enabled:false});
    expect((await f.request('/api/rooms',{displayName:'Disabled VIP',roomCode:keys.roomVipCode})).status).toBe(400);
    const switchedBack=await f.request(path('switch-role'),{matchID:host.matchID,access:'player',requestID:randomUUID()},host);
    expect(switchedBack.status).toBe(200);host=switchedBack.body;
    expect(host.playerID).not.toBe(oldHost.playerID);expect(host.advertising).toEqual({enabled:false});
    expect((await f.request(path('leave'),{},host)).status).toBe(200);
    const successor=await f.request(path(),undefined,replacement);
    expect(successor.status).toBe(200);expect(successor.body.hostPlayerID).toBe(replacement.playerID);
    expect(successor.body.advertising).toEqual(display);
    const rejoined=await f.request(path('join'),{displayName:'Creator rejoins',inviteToken});
    expect(rejoined.status).toBe(200);expect(rejoined.body.advertising).toEqual(display);
    expect((await f.request(path(),undefined,host)).status).toBe(401);
    const ordinary=await f.request('/api/rooms',{displayName:'Ordinary',adsMode:'vip',vipCreatorCredentialHash:hashToken(host.credentials)});
    expect(ordinary.status).toBe(201);expect(ordinary.body.advertising).toEqual({enabled:true,...ads});
  });
  it('does not rotate VIP identity when persisting a role switch fails',async()=>{
    const f=await fixture();
    const host=(await f.request('/api/rooms',{displayName:'VIP creator',roomCode:keys.roomVipCode})).body;
    const original=f.app.rooms.rooms.get(host.roomId)!.vipCreatorCredentialHash;
    const failure=vi.spyOn(f.app.rooms,'save').mockRejectedValueOnce(new Error('fixture failure'));
    try{
      const failed=await f.request(`/api/rooms/${host.roomId}/switch-role`,{matchID:host.matchID,access:'spectator',requestID:randomUUID()},host);
      expect(failed.status).toBe(500);
    }finally{failure.mockRestore();}
    expect(f.app.rooms.rooms.get(host.roomId)!.vipCreatorCredentialHash).toBe(original);
    const retained=await f.request(`/api/rooms/${host.roomId}`,undefined,host);
    expect(retained.status).toBe(200);expect(retained.body.advertising).toEqual({enabled:false});
    await f.restart();
    expect((await f.request(`/api/rooms/${host.roomId}`,undefined,host)).body.advertising).toEqual({enabled:false});
  });
  it('rejects corrupt VIP ownership records rather than loading an ambiguous privilege',async()=>{
    const f=await fixture();
    const host=(await f.request('/api/rooms',{displayName:'VIP creator',roomCode:keys.roomVipCode})).body;
    const room=f.app.rooms.rooms.get(host.roomId)!;
    const directory=join(f.app.config.dataDir,'invalid-room-index');await mkdir(directory);
    for(const invalid of [
      {...room,vipCreatorCredentialHash:undefined}, {...room,vipCreatorCredentialHash:'bad'},
      {...room,adsMode:'standard'}, {...room,adsMode:'unknown'},
    ]){
      await writeFile(join(directory,'rooms.json'),JSON.stringify([invalid]));
      await expect(new RoomStore(directory).load()).rejects.toThrow('房間索引格式錯誤');
    }
  });
  it('rejects invalid optional codes and keeps the adfree mode in ordinary statistics rather than testing mode',async()=>{
    const f=await fixture();expect((await f.request('/api/rooms',{displayName:'Host',roomCode:'wrong',adsMode:'adfree'})).status).toBe(400);
    const free=await f.request('/api/rooms',{displayName:'Host',roomCode:keys.roomCode});
    expect(free.body.testRoom).toBe(false);expect(f.app.rooms.rooms.get(free.body.roomId)).toMatchObject({adsMode:'adfree',testRoom:false});
    expect((await f.request(`/api/rooms/${free.body.roomId}`)).status).toBe(401);
  });
  it('accepts old open-tab request fields without restoring the mandatory creation gate',async()=>{
    const f=await fixture();
    const legacy=await f.request('/api/rooms',{displayName:'Old tab',createKey:keys.roomCode});
    expect(legacy.status).toBe(201);expect(legacy.body.advertising).toEqual({enabled:false});
    const explicit=await f.request('/api/rooms',{displayName:'No code',roomCode:'',createKey:keys.testRoomCode,testRoom:true,adsMode:'adfree'});
    expect(explicit.status).toBe(201);expect(explicit.body.testRoom).toBe(false);expect(explicit.body.advertising).toEqual({enabled:true,...ads});
    for(const roomCode of [null,true,{},42])
      expect((await f.request('/api/rooms',{displayName:'Invalid',roomCode})).status).toBe(400);
  });
  it('serves readable privacy content without scripts executing and substitutes only safe public contact information',async()=>{
    const f=await fixture(true);
    for(const path of ['/privacy','/privacy/','/privacy.html']){
      const page=await f.request(path+'?invite=do-not-reflect');expect(page.status).toBe(200);
      expect(page.body).toContain('隱私權政策');expect(page.body).toContain('mailto:privacy@example.com');
      expect(page.body).toContain('Google');expect(page.body).toContain('localStorage');expect(page.body).not.toContain('do-not-reflect');
      expect(page.body).not.toContain('ca-pub-');expect(page.headers.get('referrer-policy')).toBe('no-referrer');
      expect((await f.request(path,undefined,undefined,'HEAD')).body).toBe('');
      expect((await f.request(path,{},undefined,'POST')).status).toBe(404);
    }
    expect((await f.request('/privacy.css')).status).toBe(200);expect(f.app.rooms.rooms.size).toBe(0);
  });
  it('serves return-link navigation without leaking query contents or changing the room',async()=>{
    const f=await fixture(true);
    const created=await f.request('/api/rooms',{displayName:'Host'});
    const host=created.body;
    expect(created.status).toBe(201);
    const returned=await f.request(`/room/${host.roomId}?returned=do-not-reflect`);
    expect(returned.status).toBe(200);expect(returned.body).toContain('id="root"');
    expect(returned.body).not.toContain('do-not-reflect');expect(returned.body).not.toContain(host.credentials);
    const current=await f.request(`/api/rooms/${host.roomId}`,undefined,host);
    expect(current.body.matchID).toBe(host.matchID);expect(current.body.status).toBe('lobby');
    expect((await f.request(`/api/rooms/${host.roomId}`)).status).toBe(401);
  });
});
