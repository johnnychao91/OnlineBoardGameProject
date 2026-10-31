import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../games/catalog';
import type { RoomInfo } from './api';
import { completedGameReturn, completedReturnPath } from './game-return';
import { CompletedGameReturn } from './CompletedGameReturn';
import { Header } from './ui';
import { RulesPage } from './RulesPage';

const playing={roomId:'abcdefghijklmnop',matchID:'completed-match',gameName:'space-station',status:'playing',
  advertising:{enabled:true,client:'ca-pub-1234567890123456',slot:'1234567890'}} as RoomInfo;
const lobby={...playing,matchID:'new-lobby-match',status:'lobby',history:[{
  matchID:playing.matchID,ending:'completed' as const,endedAt:1,numPlayers:4,
}]};

describe('Completed-game vignette navigation',()=>{
  it.each(GAME_IDS)('%s offers one return after an observed complete match, including missed final polls',gameName=>{
    for(const status of ['playing','finished'])
      expect(completedGameReturn({...playing,gameName,status},{...lobby,gameName})).toBe(playing.matchID);
    expect(completedGameReturn({...lobby,gameName},{...lobby,gameName})).toBeNull();
    expect(completedGameReturn(null,{...lobby,gameName})).toBeNull();
  });
  it('does not turn aborts, reconnects, game switches or other rooms into ad opportunities',()=>{
    for(const next of [
      {...lobby,history:undefined},
      {...lobby,history:[{...lobby.history[0],ending:'host-ended' as const}]},
      {...lobby,history:[{...lobby.history[0],ending:'empty' as const}]},
      {...lobby,history:[{...lobby.history[0],matchID:'unrelated'}]},
      {...lobby,roomId:'another-room'}, {...lobby,matchID:playing.matchID}, {...lobby,status:'playing'},
    ]) expect(completedGameReturn(playing,next)).toBeNull();
    expect(completedGameReturn({...playing,status:'lobby'},lobby)).toBeNull();
  });
  it('requires an authenticated advertising descriptor and excludes testing and adfree rooms',()=>{
    for(const advertising of [undefined,{enabled:false},{...playing.advertising!,slot:'bad'}])
      expect(completedGameReturn(playing,{...lobby,advertising})).toBeNull();
    expect(completedGameReturn(playing,{...lobby,testRoom:true})).toBeNull();
    expect(completedGameReturn({...playing,testRoom:true},lobby)).toBeNull();
  });
  it('uses an ordinary same-tab GET link with no script-driven reload, secret or ad wait',()=>{
    expect(completedReturnPath(playing.roomId,playing.matchID)).toBe('/room/abcdefghijklmnop?returned=completed-match');
    expect(completedReturnPath(playing.roomId,'match?x=1#hash')).toContain('returned=match%3Fx%3D1%23hash');
    const html=renderToStaticMarkup(createElement(CompletedGameReturn,{info:lobby,matchID:playing.matchID,onContinue:()=>{}}));
    expect(html).toContain('href="/room/abcdefghijklmnop?returned=completed-match"');
    expect(html).toContain('返回等待室');
    expect(html).not.toMatch(/data-google-vignette="false"|<script|target=|disabled|credentials|invite|ca-pub-/);
  });
  it('excludes unrelated header, rules and catalogue links from click-triggered vignettes',()=>{
    const pages=[renderToStaticMarkup(createElement(Header,{room:playing.roomId})),
      renderToStaticMarkup(createElement(RulesPage)),
      ...GAME_IDS.map(gameID=>renderToStaticMarkup(createElement(RulesPage,{gameID})))];
    for(const html of pages){
      const links=html.match(/<a\b[^>]*>/g)??[];
      expect(links.length).toBeGreaterThan(0);
      for(const link of links)expect(link).toContain('data-google-vignette="false"');
    }
  });
});
