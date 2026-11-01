import { describe, expect, it } from 'vitest';
import { creationKind, roomAdvertising, validAdSettings, validateRoomCodes, roomCodesFromEnvironment } from './advertising';
import { hashToken } from './security';
const keys={roomCode:'free-fixture-code-12345',testRoomCode:'test-fixture-code-12345'};
const ads={client:'ca-pub-1234567890123456',slot:'1234567890'};
describe('Private deployment advertising policy',()=>{
  it('allows public creation and only applies special modes for matching optional codes',()=>{
    for(const code of [undefined,'']) expect(creationKind(code,keys)).toBe('standard');
    expect(creationKind(keys.roomCode,keys)).toBe('adfree');
    expect(creationKind(keys.testRoomCode,keys)).toBe('test');
    for(const code of ['wrong',{},true,null,0])expect(creationKind(code,keys)).toBeNull();
    expect(creationKind(undefined,{})).toBe('standard');
    expect(creationKind(keys.roomCode,{})).toBeNull();
    expect(creationKind(keys.testRoomCode,{roomCode:keys.roomCode})).toBeNull();
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
  it('rejects overlapping or short codes but allows both special modes to be disabled',()=>{
    expect(()=>validateRoomCodes(keys)).not.toThrow();
    expect(()=>validateRoomCodes({})).not.toThrow();
    expect(()=>validateRoomCodes({roomCode:'',testRoomCode:''})).not.toThrow();
    for(const config of [{roomCode:'short'},{testRoomCode:'short'},{...keys,testRoomCode:keys.roomCode}])
      expect(()=>validateRoomCodes(config)).toThrow('ROOM_CODE');
    expect(()=>validateRoomCodes({...keys,roomVipCode:'vip-fixture'})).not.toThrow();
    for(const roomVipCode of Object.values(keys))expect(()=>validateRoomCodes({...keys,roomVipCode})).toThrow('ROOM_VIP_CODE');
  });
  it('uses new environment names, supports upgrading old deployments and honors explicit disabling',()=>{
    expect(roomCodesFromEnvironment({})).toEqual({roomCode:'',testRoomCode:'',roomVipCode:''});
    const legacy={CREATE_ROOM_KEY:'legacy-create-fixture-code',ADFREE_ROOM_KEY:'legacy-adfree-fixture-code',TEST_ROOM_KEY:'legacy-test-fixture-code'};
    expect(roomCodesFromEnvironment(legacy)).toEqual({roomCode:legacy.CREATE_ROOM_KEY,testRoomCode:legacy.TEST_ROOM_KEY,roomVipCode:''});
    expect(roomCodesFromEnvironment({ADFREE_ROOM_KEY:legacy.ADFREE_ROOM_KEY})).toEqual({roomCode:legacy.ADFREE_ROOM_KEY,testRoomCode:'',roomVipCode:''});
    expect(roomCodesFromEnvironment({...legacy,ROOM_CODE:keys.roomCode,TEST_ROOM_CODE:keys.testRoomCode})).toEqual({...keys,roomVipCode:''});
    expect(roomCodesFromEnvironment({...legacy,ROOM_CODE:'',TEST_ROOM_CODE:''})).toEqual({roomCode:'',testRoomCode:'',roomVipCode:''});
    const upgraded=roomCodesFromEnvironment(legacy);
    expect(creationKind(undefined,upgraded)).toBe('standard');
    expect(creationKind(legacy.CREATE_ROOM_KEY,upgraded)).toBe('adfree');
    expect(creationKind(legacy.TEST_ROOM_KEY,upgraded)).toBe('test');
  });
  it('keeps VIP creator benefits bound to the membership and disables vignettes for every other viewer',()=>{
    const roomVipCode='vip-fixture';
    expect(creationKind(roomVipCode,roomCodesFromEnvironment({ROOM_VIP_CODE:roomVipCode}))).toBe('vip');
    expect(creationKind(roomVipCode,{})).toBeNull();
    const owner=hashToken('creator'),guest=hashToken('guest');
    const room={adsMode:'vip' as const,vipCreatorCredentialHash:owner};
    expect(roomAdvertising(room,ads,false,owner)).toEqual({enabled:false});
    for(const viewer of [guest,undefined])expect(roomAdvertising(room,ads,false,viewer)).toEqual({enabled:true,...ads,vignette:false});
    expect(roomAdvertising(room,ads,true,guest)).toEqual({enabled:false});
    expect(roomAdvertising({...room,testRoom:true},ads,false,guest)).toEqual({enabled:false});
  });
});
