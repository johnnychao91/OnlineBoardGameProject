import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Advertising } from './Advertising';
import { validAdUnit, roomContextPath, createAdSafeNavigationHandler } from './adsense';
import { navigate } from './ui';
const ads={enabled:true,client:'ca-pub-1234567890123456',slot:'1234567890'};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
describe('Room advertising privacy and loading',()=>{
  it('reloads browser history navigation after loading ads on a route entered from home',()=>{
    const update=vi.fn(),reload=vi.fn();
    const currentLocation={pathname:'/',reload};
    const dataset:{adsLoaded?:string}={};
    vi.stubGlobal('location',currentLocation);
    vi.stubGlobal('document',{documentElement:{dataset}});
    const navigateHistory=createAdSafeNavigationHandler(update);
    currentLocation.pathname='/room/abcdefghijklmnop';navigateHistory();
    expect(update).toHaveBeenCalledTimes(1);expect(reload).not.toHaveBeenCalled();
    dataset.adsLoaded='true';navigateHistory();
    expect(update).toHaveBeenCalledTimes(2);expect(reload).not.toHaveBeenCalled();
    currentLocation.pathname='/';navigateHistory();
    expect(reload).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledTimes(2);
    currentLocation.pathname='/room/qrstuvwxyzABCDEF';navigateHistory();
    expect(reload).toHaveBeenCalledTimes(2);expect(update).toHaveBeenCalledTimes(2);
  });
  it('starts a fresh document when leaving a page that loaded advertising',()=>{
    const assign=vi.fn(),pushState=vi.fn();
    vi.stubGlobal('document',{documentElement:{dataset:{adsLoaded:'true'}}});
    vi.stubGlobal('window',{location:{assign}});vi.stubGlobal('history',{pushState});
    navigate('/');expect(assign).toHaveBeenCalledExactlyOnceWith('/');expect(pushState).not.toHaveBeenCalled();
    navigate('/room/abcdefghijklmnop');expect(assign).toHaveBeenLastCalledWith('/room/abcdefghijklmnop');
  });
  it('renders no advertising or account values for unknown, disabled or incomplete room settings',()=>{
    for(const settings of [undefined,{...ads,enabled:false},{enabled:true},{...ads,slot:'bad'}]){
      expect(renderToStaticMarkup(createElement(Advertising,{settings}))).toBe('');
    }
    const html=renderToStaticMarkup(createElement(Advertising,{settings:ads}));
    expect(html).toContain('aria-label="廣告"');expect(html).toContain('data-ad-slot="1234567890"');
    expect(html).not.toContain('<script');expect(html).not.toMatch(/credentials|playerID|roomId/);
  });
  it('only propagates a valid room context, never invitation fragments or arbitrary query strings',()=>{
    expect(roomContextPath('/privacy','short-room')).toBe('/privacy');
    expect(roomContextPath('/rules','abcdefghijklmnop')).toBe('/rules?room=abcdefghijklmnop');
    vi.stubGlobal('location',{search:'?room=abcdefghijklmnop&invite=private'});
    expect(roomContextPath('/privacy')).toBe('/privacy?room=abcdefghijklmnop');
    expect(validAdUnit(ads.client,ads.slot)).toBe(true);expect(validAdUnit(ads.client,'<script>')).toBe(false);
  });
  it('does not load on import, deduplicates explicit loads and rejects a different publisher',async()=>{
    const appended:any[]=[];const createElement=vi.fn(()=>({remove:vi.fn()}));
    vi.stubGlobal('document',{createElement,documentElement:{dataset:{}},head:{appendChild:(s:any)=>appended.push(s)}});
    vi.stubGlobal('window',{setTimeout,clearTimeout});
    const sdk=await import('./adsense');expect(createElement).not.toHaveBeenCalled();
    const pending=sdk.loadAdSense(ads.client);expect(sdk.loadAdSense(ads.client)).toBe(pending);
    expect(appended).toHaveLength(1);expect(appended[0].crossOrigin).toBe('anonymous');expect(appended[0].async).toBe(true);
    expect(appended[0].src).toContain(encodeURIComponent(ads.client));expect(sdk.requiresFreshDocument()).toBe(true);
    appended[0].onload();await pending;
    await expect(sdk.loadAdSense('ca-pub-1111111111111111')).rejects.toThrow('changed');
  });
  it('settles blocked and timed-out SDK requests without retrying ads on a timer',async()=>{
    for(const timeout of [false,true]){
      vi.resetModules();vi.useFakeTimers();let script:any;
      vi.stubGlobal('document',{createElement:()=>({remove:vi.fn()}),documentElement:{dataset:{}},head:{appendChild:(s:any)=>{script=s;}}});
      vi.stubGlobal('window',{setTimeout,clearTimeout});
      const sdk=await import('./adsense');
      const pending=sdk.loadAdSense(ads.client);const rejected=expect(pending).rejects.toThrow(timeout?'timed out':'failed');
      if(timeout)await vi.advanceTimersByTimeAsync(10000);else script.onerror();
      await rejected;expect(script.remove).toHaveBeenCalledOnce();expect(sdk.loadAdSense(ads.client)).toBe(pending);
      vi.useRealTimers();
    }
  });
});
