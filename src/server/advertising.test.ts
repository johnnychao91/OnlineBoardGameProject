import { describe, expect, it } from 'vitest';
import { creationKind, roomAdvertising, validAdSettings, validateAdFreeKey } from './advertising';
const keys={createRoomKey:'normal-fixture-key-123',adFreeRoomKey:'free-fixture-key-12345',testRoomKey:'test-fixture-key-12345'};
const ads={client:'ca-pub-1234567890123456',slot:'1234567890'};
describe('Private deployment advertising policy',()=>{
  it('assigns a room-wide immutable creation kind from server keys only',()=>{
    expect(creationKind(keys.createRoomKey,keys)).toBe('standard');
    expect(creationKind(keys.adFreeRoomKey,keys)).toBe('adfree');
    expect(creationKind(keys.testRoomKey,keys)).toBe('test');
    for(const key of [undefined,'wrong',{},true])expect(creationKind(key,keys)).toBeNull();
  });
  it('enables normal and legacy rooms but excludes adfree, testing and historical views',()=>{
    expect(roomAdvertising({},ads)).toEqual({enabled:true,...ads});
    expect(roomAdvertising({adsMode:'standard'},ads)).toEqual({enabled:true,...ads});
    for(const room of [{adsMode:'adfree' as const},{testRoom:true},{testRoom:true,adsMode:'standard' as const}])expect(roomAdvertising(room,ads)).toEqual({enabled:false});
    expect(roomAdvertising({},ads,true)).toEqual({enabled:false});
    expect(roomAdvertising({})).toEqual({enabled:false});
  });
  it('never enables incomplete or malformed advertising settings',()=>{
    for(const settings of [{client:'ca-pub-1',slot:ads.slot},{client:ads.client,slot:'bad'},undefined]){
      expect(validAdSettings(settings)).toBe(false);expect(roomAdvertising({},settings)).toEqual({enabled:false});
    }
  });
  it('rejects overlapping or short adfree keys',()=>{
    expect(()=>validateAdFreeKey(keys)).not.toThrow();
    for(const adFreeRoomKey of [keys.createRoomKey,keys.testRoomKey,'short'])expect(()=>validateAdFreeKey({...keys,adFreeRoomKey})).toThrow('ADFREE_ROOM_KEY');
  });
});
