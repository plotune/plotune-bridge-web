import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { SerialChannel, SerialConfig, SerialStatistics } from '../src/device/serial';

type JsonRecord = Record<string, unknown>;
interface MockRequest { type:'request'; id:number; op:string; params:JsonRecord }
const isRecord=(x:unknown):x is JsonRecord=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const isChannelId=(x:unknown):x is number=>x===1||x===2;
const isSelection=(x:unknown):x is number[]=>Array.isArray(x)&&x.length>0&&x.every(isChannelId)&&new Set(x).size===x.length;
const isRequest=(x:unknown):x is MockRequest=>isRecord(x)&&Object.keys(x).sort().join(',')==='id,op,params,type'&&x.type==='request'&&Number.isSafeInteger(x.id)&&Number(x.id)>0&&typeof x.op==='string'&&isRecord(x.params);
const CONFIG_KEYS=['baud_rate','bias','data_bits','mode','parity','stop_bits','termination'];
function isConfig(x:unknown):x is SerialConfig {
  return isRecord(x)&&Object.keys(x).sort().join(',')===CONFIG_KEYS.join(',')&&['rs232','rs422','rs485'].includes(String(x.mode))&&typeof x.baud_rate==='number'&&[9600,19200,38400,57600,115200,1000000].includes(x.baud_rate)&&typeof x.data_bits==='number'&&[5,6,7,8].includes(x.data_bits)&&['none','even','odd'].includes(String(x.parity))&&(x.stop_bits===1||x.stop_bits===2)&&typeof x.termination==='boolean'&&typeof x.bias==='boolean'&&!(x.mode==='rs232'&&x.termination)&&!(x.mode!=='rs485'&&x.bias);
}
const statCounterKeys: (keyof Omit<SerialStatistics,'channel'>)[]=['rx_bytes_received','rx_bytes_forwarded','rx_bytes_dropped','rx_overrun_bytes','rx_queue_overflow_bytes','tx_bytes_accepted','tx_bytes_sent','tx_bytes_failed','tx_echo_dropped','framing_errors','parity_errors','break_events','rx_overrun_events'];

/** Contract-shaped software peer. Nanosecond fields are emitted as unquoted JSON integer tokens. */
export class MockSerialServer {
  private wss=new WebSocketServer({host:'127.0.0.1',port:0}); private current:WebSocket|null=null; private seq=0;
  contractVersion='0.1.0'; deviceId='MOCK-SER-01'; descriptorChannels=2; malformedDescriptor=false; reverseChannels=false;
  supportedModes=['rs232','rs422','rs485'];supportedRates=[9600,19200,38400,57600,115200,1000000];
  channels:SerialChannel[]=[1,2].map(channel=>({channel,name:`Serial ${channel}`,config:null,streaming:false,rx_queue_depth:0,rx_queue_capacity:256}));
  private statistics:SerialStatistics[]=[1,2].map(channel=>({channel,rx_bytes_received:0,rx_bytes_forwarded:0,rx_bytes_dropped:0,rx_overrun_bytes:0,rx_queue_overflow_bytes:0,tx_bytes_accepted:0,tx_bytes_sent:0,tx_bytes_failed:0,tx_echo_dropped:0,framing_errors:0,parity_errors:0,break_events:0,rx_overrun_events:0}));
  get url(){return `ws://127.0.0.1:${(this.wss.address() as AddressInfo).port}`;}
  async ready(){if(!this.wss.address())await new Promise<void>(r=>this.wss.once('listening',r));return this;}
  private serialize(message:unknown){return JSON.stringify(message,(_k,v)=>typeof v==='bigint'?String(v):v).replace(/("(?:timestamp_ns|since_ns|monotonic_ns|wall_clock_ns)"\s*:)\s*"(\d+)"/g,'$1$2');}
  private send(ws:WebSocket,message:unknown,callback?:(error?:Error)=>void){if(ws.readyState===ws.OPEN)ws.send(this.serialize(message),callback);}
  inject(channel:number,data='0041ff',dropped=2,timestamp=18446744073709551000n,seq?:number){const status=this.channels[channel-1];if(!this.current)throw new Error('cannot inject serial data without a connected client');if(!status)throw new Error(`cannot inject serial data for unknown channel ${channel}`);if(!status.streaming)throw new Error(`cannot inject serial data while channel ${channel} is stopped`);const event={seq:seq??++this.seq,channel,dropped,timestamp_ns:timestamp,direction:'rx',data};const stats=this.statistics[channel-1]!;stats.rx_bytes_received+=data.length/2+dropped;stats.rx_bytes_forwarded+=data.length/2;stats.rx_bytes_dropped+=dropped;this.send(this.current,{type:'event',event:'rx_data',data:event});}
  injectThenClose(channel:number,data='0041ff',code=4002,reason='device disconnected after queued RX'){const status=this.channels[channel-1];if(!this.current)throw new Error('cannot inject serial data without a connected client');if(!status)throw new Error(`cannot inject serial data for unknown channel ${channel}`);if(!status.streaming)throw new Error(`cannot inject serial data while channel ${channel} is stopped`);const ws=this.current;const event={seq:++this.seq,channel,dropped:0,timestamp_ns:18446744073709551000n,direction:'rx',data};const stats=this.statistics[channel-1]!;stats.rx_bytes_received+=data.length/2;stats.rx_bytes_forwarded+=data.length/2;this.send(ws,{type:'event',event:'rx_data',data:event},error=>{if(!error&&ws.readyState===ws.OPEN)ws.close(code,reason);});}
  recordOverrun(channel:number,count=1){this.statistics[channel-1]!.rx_overrun_events+=count;}
  closeCurrent(code=1006,reason='device disconnected'){if(code===1006)this.current?.terminate();else this.current?.close(code,reason);}
  private answer(ws:WebSocket,id:number,result:unknown){this.send(ws,{type:'response',id,ok:true,result});}
  private fail(ws:WebSocket,id:number,code:string,message:string){this.send(ws,{type:'response',id,ok:false,error:{code,message,details:{}}});}
  private channel(id:unknown):SerialChannel|undefined{return isChannelId(id)?this.channels.find(c=>c.channel===id):undefined;}
  private connect(ws:WebSocket){const previous=this.current;this.current=ws;previous?.close(4001,'replaced by a new connection');let handshaken=false;ws.on('message',raw=>{
    let parsed:unknown;try{parsed=JSON.parse(raw.toString());}catch{return ws.close(4000,'invalid JSON');}
    if(!isRequest(parsed))return ws.close(4000,'invalid request envelope');
    const {id,op,params}=parsed;
    if(op==='hello'){
      if(Object.keys(params).some(k=>!['contract_version','client'].includes(k))||typeof params.contract_version!=='string')return this.fail(ws,id,'MALFORMED_REQUEST','invalid hello parameters');
      if(params.contract_version!=='0.1.0')return this.fail(ws,id,'UNSUPPORTED_VERSION','contract version is not supported');
      handshaken=true;
      const channels=this.channels.slice(0,this.descriptorChannels).map(c=>({...c}));if(this.malformedDescriptor&&channels[0])channels[0].channel=3;if(this.reverseChannels)channels.reverse();
      return this.answer(ws,id,{contract_version:this.contractVersion,session_id:'mock-session',device_id:this.deviceId,firmware:'mock',profile:'dual-channel',supported_modes:this.supportedModes,supported_baud_rates:this.supportedRates,rx_queue_capacity:256,clock:{monotonic_ns:18446744073709551000n,wall_clock_ns:null,wall_clock_synced:false},channels});
    }
    if(!handshaken)return this.fail(ws,id,'MALFORMED_REQUEST','hello is required first');
    const selection=params.channels;
    if(op==='get_channel_status'){
      if(Object.keys(params).some(k=>k!=='channels')||(selection!==undefined&&!isSelection(selection)))return this.fail(ws,id,'MALFORMED_REQUEST','invalid channel selection');
      return this.answer(ws,id,{channels:this.channels.filter(c=>selection===undefined||(selection as number[]).includes(c.channel)).map(c=>({...c}))});
    }
    if(op==='get_statistics'){
      if(Object.keys(params).some(k=>!['channels','reset'].includes(k))||(selection!==undefined&&!isSelection(selection))||(params.reset!==undefined&&typeof params.reset!=='boolean')||(params.reset===true&&selection!==undefined&&(selection as number[]).length!==2))return this.fail(ws,id,'MALFORMED_REQUEST','invalid statistics parameters');
      const result={timestamp_ns:18446744073709551000n,since_ns:1000000000n,statistics:this.statistics.filter(s=>selection===undefined||(selection as number[]).includes(s.channel)).map(s=>({...s}))};this.answer(ws,id,result);
      if(params.reset===true)this.statistics.forEach(s=>statCounterKeys.forEach(k=>{s[k]=0;}));return;
    }
    if(op==='configure_channel'){
      if(Object.keys(params).sort().join(',')!=='channel,config')return this.fail(ws,id,'MALFORMED_REQUEST','invalid configure parameters');
      const status=this.channel(params.channel);if(!status)return this.fail(ws,id,'UNKNOWN_CHANNEL','unknown channel');if(status.streaming)return this.fail(ws,id,'CHANNEL_BUSY','stop RX before reconfiguration');
      if(!isConfig(params.config)||!this.supportedModes.includes(params.config.mode)||!this.supportedRates.includes(params.config.baud_rate))return this.fail(ws,id,'INVALID_CONFIGURATION','invalid configuration');status.config={...params.config};return this.answer(ws,id,{channel:{...status}});
    }
    if(op==='start_rx'||op==='stop_rx'){
      if(Object.keys(params).some(k=>k!=='channels')||(selection!==undefined&&!isSelection(selection)))return this.fail(ws,id,'MALFORMED_REQUEST','channels must select known channels');
      const ids=selection??[1,2];const selected=ids.map(id=>this.channel(id)).filter((c):c is SerialChannel=>c!==undefined);
      if(selected.length!==ids.length)return this.fail(ws,id,'UNKNOWN_CHANNEL','unknown channel');if(op==='start_rx'&&selected.some(c=>c.config===null))return this.fail(ws,id,'CHANNEL_NOT_CONFIGURED','configure each channel first');
      selected.forEach(c=>{c.streaming=op==='start_rx';});return this.answer(ws,id,{channels:selected.map(c=>({...c}))});
    }
    if(op==='transmit'){
      const status=this.channel(params.channel);if(!status)return this.fail(ws,id,'UNKNOWN_CHANNEL','unknown channel');if(status.config===null)return this.fail(ws,id,'CHANNEL_NOT_CONFIGURED','configure channel first');
      if(Object.keys(params).sort().join(',')!=='channel,data'||typeof params.data!=='string'||params.data.length%2!==0||! /^(?:[0-9a-f]{2})+$/.test(params.data))return this.fail(ws,id,'INVALID_DATA','data must be lowercase hex bytes');
      const bytes=params.data.length/2;this.statistics[status.channel-1]!.tx_bytes_accepted+=bytes;return this.answer(ws,id,{accepted:true,bytes_accepted:bytes});
    }
    this.fail(ws,id,'UNKNOWN_OPERATION','unknown operation');
  });ws.on('close',()=>{if(this.current===ws)this.current=null;});}
  constructor(){this.wss.on('connection',ws=>this.connect(ws));}
  async close(){this.current?.terminate();await new Promise<void>(r=>this.wss.close(()=>r()));}
}
