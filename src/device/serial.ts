/** Bridge Serial v0.1.0 browser session. Serial bytes remain independent of CAN frame types. */
import { WebSocketTransport } from '../transport/websocket';
import type { CloseInfo, DeviceTransport } from '../transport/types';
import { ProtocolViolation } from '../protocol/errors';
import { UINT64_MAX } from '../protocol/types';
import type { WireObject } from '../protocol/wire';

export type SerialMode = 'rs232' | 'rs422' | 'rs485';
export interface SerialConfig { mode: SerialMode; baud_rate: number; data_bits: number; parity: 'none'|'even'|'odd'; stop_bits: 1|2; termination: boolean; bias: boolean }
export interface SerialChannel { channel:number; name:string; config:SerialConfig|null; streaming:boolean; rx_queue_depth:number; rx_queue_capacity:number }
export interface SerialRx { seq:number; channel:number; dropped:number; timestamp_ns:bigint; direction:'rx'|'tx'; data:string }
export interface SerialStatistics {channel:number;rx_bytes_received:number;rx_bytes_forwarded:number;rx_bytes_dropped:number;rx_overrun_bytes:number;rx_queue_overflow_bytes:number;tx_bytes_accepted:number;tx_bytes_sent:number;tx_bytes_failed:number;tx_echo_dropped:number;framing_errors:number;parity_errors:number;break_events:number;rx_overrun_events:number}
export interface SerialStatisticsResult {timestamp_ns:bigint;since_ns:bigint;statistics:SerialStatistics[]}
export interface SerialDescriptor { contract_version:string; session_id:string; device_id:string; firmware:string; profile:string; supported_modes:SerialMode[]; supported_baud_rates:number[]; rx_queue_capacity:number; clock:{monotonic_ns:bigint;wall_clock_ns:bigint|null;wall_clock_synced:boolean}; channels:SerialChannel[] }
const VERSION='0.1.0';
const REQUIRED_RATES=[9600,19200,38400,57600,115200,1000000];
const MAX_PENDING=32;
const REQUEST_TIMEOUT_MS=5000;
const compatibleVersion=(v:string)=>{const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(v);return !!m&&m[1]==='0'&&m[2]==='1';};
const serialError=(message:string)=>new ProtocolViolation(`Serial protocol: ${message}`);
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const str=(x:unknown)=>typeof x==='string'&&x.length>0;
const int=(x:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&Number(x)>=min&&Number(x)<=max;
const uint64=(x:unknown)=>typeof x==='bigint'&&x>=0n&&x<=UINT64_MAX;
function configValid(x:unknown):x is SerialConfig {
  if(!record(x)||!exact(x,['mode','baud_rate','data_bits','parity','stop_bits','termination','bias'])||!['rs232','rs422','rs485'].includes(String(x.mode))||!int(x.baud_rate,1,1000000)||![5,6,7,8].includes(Number(x.data_bits))||!['none','even','odd'].includes(String(x.parity))||![1,2].includes(Number(x.stop_bits))||typeof x.termination!=='boolean'||typeof x.bias!=='boolean') return false;
  return !(x.mode==='rs232'&&x.termination)&&!(x.mode!=='rs485'&&x.bias);
}
function channelValid(x:unknown):x is SerialChannel {
  return record(x)&&exact(x,['channel','name','config','streaming','rx_queue_depth','rx_queue_capacity'])&&int(x.channel,1,2)&&x.name===`Serial ${x.channel}`&&(x.config===null||configValid(x.config))&&typeof x.streaming==='boolean'&&int(x.rx_queue_depth)&&int(x.rx_queue_capacity,1)&&Number(x.rx_queue_depth)<=Number(x.rx_queue_capacity);
}
export function validateSerialDescriptor(x:unknown):SerialDescriptor {
  if(!record(x)||!exact(x,['contract_version','session_id','device_id','firmware','profile','supported_modes','supported_baud_rates','rx_queue_capacity','clock','channels'])||typeof x.contract_version!=='string'||!compatibleVersion(x.contract_version)) throw serialError('unsupported contract version or malformed descriptor');
  if(!str(x.session_id)||!str(x.device_id)||!str(x.firmware)||!str(x.profile)||!Array.isArray(x.supported_modes)||!Array.isArray(x.supported_baud_rates)||!int(x.rx_queue_capacity,1)||!record(x.clock)||!exact(x.clock,['monotonic_ns','wall_clock_ns','wall_clock_synced'])||!uint64(x.clock.monotonic_ns)||!(x.clock.wall_clock_ns===null||uint64(x.clock.wall_clock_ns))||typeof x.clock.wall_clock_synced!=='boolean'||!Array.isArray(x.channels)||x.channels.length!==2) throw serialError('invalid descriptor');
  const modes=x.supported_modes as unknown[],rates=x.supported_baud_rates as unknown[];
  if(modes.length!==3||!(['rs232','rs422','rs485'] as unknown[]).every(m=>modes.includes(m))||new Set(modes).size!==modes.length||rates.length<REQUIRED_RATES.length||rates.some(rate=>!int(rate,1,1000000))||new Set(rates).size!==rates.length||!REQUIRED_RATES.every(n=>rates.includes(n))||x.channels.some(c=>!channelValid(c))||new Set(x.channels.map(c=>(c as SerialChannel).channel)).size!==2) throw serialError('descriptor capabilities do not satisfy v0.1.0');
  if(x.channels.some(raw=>{const c=raw as SerialChannel;return c.config!==null&&(!modes.includes(c.config.mode)||!rates.includes(c.config.baud_rate));}))throw serialError('channel config exceeds advertised capabilities');
  return {...x,channels:[...(x.channels as SerialChannel[])].sort((a,b)=>a.channel-b.channel)} as unknown as SerialDescriptor;
}
function validateRx(x:unknown):SerialRx {
  if(!record(x)||!exact(x,['seq','channel','dropped','timestamp_ns','direction','data'])||!int(x.seq,0,Number.MAX_SAFE_INTEGER)||!int(x.channel,1,2)||!int(x.dropped)||!uint64(x.timestamp_ns)||!['rx','tx'].includes(String(x.direction))||typeof x.data!=='string'||x.data.length%2!==0||!/^([0-9a-f]{2})*$/.test(x.data)||(!x.data&&!(x.direction==='rx'&&Number(x.dropped)>0))) throw serialError('invalid rx_data event');
  return x as unknown as SerialRx;
}
function validateStatus(x:unknown,modes:SerialMode[],rates:number[]):SerialChannel { if(!channelValid(x))throw serialError('invalid channel_status event');if(x.config!==null&&(!modes.includes(x.config.mode)||!rates.includes(x.config.baud_rate)))throw serialError('channel status exceeds advertised capabilities');return x; }
const STAT_KEYS=['channel','rx_bytes_received','rx_bytes_forwarded','rx_bytes_dropped','rx_overrun_bytes','rx_queue_overflow_bytes','tx_bytes_accepted','tx_bytes_sent','tx_bytes_failed','tx_echo_dropped','framing_errors','parity_errors','break_events','rx_overrun_events'];
const ERROR_CODES=['MALFORMED_REQUEST','UNKNOWN_OPERATION','UNSUPPORTED_VERSION','UNKNOWN_CHANNEL','UNSUPPORTED_MODE','UNSUPPORTED_BAUD_RATE','INVALID_CONFIGURATION','CHANNEL_BUSY','CHANNEL_NOT_CONFIGURED','TX_QUEUE_FULL','INVALID_DATA','NOT_CONNECTED','DEVICE_DISCONNECTED','TIMEOUT','INTERNAL_ERROR'];
function validateStatistics(x:unknown):SerialStatisticsResult {
  if(!record(x)||!exact(x,['timestamp_ns','since_ns','statistics'])||!uint64(x.timestamp_ns)||!uint64(x.since_ns)||!Array.isArray(x.statistics)||x.statistics.length<1||x.statistics.length>2||x.statistics.some(s=>!record(s)||!exact(s,STAT_KEYS)||!int(s.channel,1,2)||STAT_KEYS.slice(1).some(k=>!int(s[k]))))throw serialError('invalid get_statistics result');
  return x as unknown as SerialStatisticsResult;
}
function validateResult(op:string,params:Record<string,unknown>,x:unknown,modes:SerialMode[],rates:number[]):void {
  if(op==='hello')return; // The caller validates the descriptor so it can surface a useful compatibility error.
  if(op==='configure_channel'){if(!record(x)||!exact(x,['channel']))throw serialError('invalid configure_channel result');validateStatus(x.channel,modes,rates);if((x.channel as SerialChannel).channel!==params.channel)throw serialError('configure_channel returned a different channel');return;}
  if(op==='start_rx'||op==='stop_rx'||op==='get_channel_status'){
    const expected=Array.isArray(params.channels)?params.channels:[1,2];
    if(!record(x)||!exact(x,['channels'])||!Array.isArray(x.channels)||x.channels.length!==expected.length||x.channels.some(c=>!channelValid(c))||x.channels.some(c=>!expected.includes((c as SerialChannel).channel)||((c as SerialChannel).config!==null&&(!modes.includes((c as SerialChannel).config!.mode)||!rates.includes((c as SerialChannel).config!.baud_rate))))||new Set(x.channels.map(c=>(c as SerialChannel).channel)).size!==x.channels.length)throw serialError(`invalid ${op} result`);return;
  }
  if(op==='transmit'){
    if(!record(x)||!exact(x,['accepted','bytes_accepted'])||x.accepted!==true||!int(x.bytes_accepted,1)||x.bytes_accepted!==String(params.data??'').length/2)throw serialError('invalid transmit result');return;
  }
  if(op==='get_statistics'){const result=validateStatistics(x),expected=Array.isArray(params.channels)?params.channels:[1,2];if(result.statistics.length!==expected.length||result.statistics.some(s=>!expected.includes(s.channel))||new Set(result.statistics.map(s=>s.channel)).size!==expected.length)throw serialError('get_statistics returned an unexpected channel set');return;}
  throw serialError(`unexpected operation ${op}`);
}

export class SerialClient {
  private id=0; private pending=new Map<number,{resolve:(x:unknown)=>void;reject:(e:Error)=>void;timer:number;op:string;params:Record<string,unknown>}>();private timedOut=new Set<number>();private supportedModes:SerialMode[]=[];private supportedRates:number[]=[];
  private events:{rx?:(x:SerialRx)=>void;status?:(x:SerialChannel)=>void;close?:(info:CloseInfo)=>void}={};
  private seq:number|null=null; private closed=false;private closeInfo:CloseInfo|null=null;
  private constructor(private transport:DeviceTransport) {
    transport.setListener({message:m=>{try{this.message(m);}catch(e){this.violation(e instanceof Error?e.message:'invalid Serial message');}},closed:info=>this.closedLink(info)});
  }
  static async connect(url:string,signal?:AbortSignal):Promise<{client:SerialClient;descriptor:SerialDescriptor}> {
    const transport=new WebSocketTransport(url); const client=new SerialClient(transport);
    const abort=()=>{transport.close();client.closedLink({phase:'connecting',code:null,reason:'connection cancelled',wasClean:false,initiatedBy:'local'});};
    try {
      if(signal?.aborted)throw new Error('Serial connection cancelled');
      signal?.addEventListener('abort',abort,{once:true});
      await transport.open();
      const d=validateSerialDescriptor(await client.request('hello',{contract_version:VERSION,client:'plotune-bridge-web'}));client.supportedModes=d.supported_modes;client.supportedRates=d.supported_baud_rates;
      if(signal?.aborted)throw new Error('Serial connection cancelled');
      return {client,descriptor:d};
    } catch(e) { client.close(); throw e; } finally {signal?.removeEventListener('abort',abort);}
  }
  get isConnected(){return !this.closed;}
  on(events:typeof this.events){this.events=events;if(this.closed&&this.closeInfo)events.close?.(this.closeInfo);}
  private message(m:WireObject) {
    if(m.type==='response') {
      if(!(exact(m,['type','id','ok','result'])||exact(m,['type','id','ok','error']))||!int(m.id,1)||typeof m.ok!=='boolean')return this.violation('malformed response envelope');
      const p=this.pending.get(Number(m.id)); if(!p){if(this.timedOut.has(Number(m.id))){this.timedOut.delete(Number(m.id));return;}return this.violation('unexpected response id');}
      if(m.ok) { if(!('result'in m)||'error'in m)return this.violation('successful response lacks result'); }
      else if(!record(m.error)||!(exact(m.error,['code','message','details'])||exact(m.error,['code','message']))||!ERROR_CODES.includes(String(m.error.code))||typeof m.error.message!=='string'||('details'in m.error&&!record(m.error.details)))return this.violation('malformed error response');
      if(m.ok){try{validateResult(p.op,p.params,m.result,this.supportedModes,this.supportedRates);}catch(e){return this.violation(e instanceof Error?e.message:'invalid response result');}}
      this.pending.delete(Number(m.id));clearTimeout(p.timer);
      if(m.ok)p.resolve(m.result);else p.reject(new Error(`${(m.error as Record<string,unknown>).code}: ${(m.error as Record<string,unknown>).message}`));
      return;
    }
    if(m.type==='event'&&exact(m,['type','event','data'])&&typeof m.event==='string'&&'data'in m) {
      if(m.event==='rx_data') {const x=validateRx(m.data);if(this.seq!==null&&x.seq>this.seq+1){/* gaps are represented in the trace by the view */}if(this.seq!==null&&x.seq<=this.seq)return this.violation('non-increasing event sequence');this.seq=x.seq;this.events.rx?.(x);return;}
      if(m.event==='channel_status'){const status=validateStatus(m.data,this.supportedModes,this.supportedRates);this.events.status?.(status);return;}
      return this.violation(`unknown event ${m.event}`);
    }
    this.violation('malformed message envelope');
  }
  private violation(reason:string){this.transport.close();this.closedLink({phase:'open',code:4000,reason,wasClean:false,initiatedBy:'local'});}
  private closedLink(info:CloseInfo){if(this.closed)return;this.closed=true;this.closeInfo=info;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Device disconnected'));}this.pending.clear();this.events.close?.(info);}
  private request(op:string,params:Record<string,unknown>={}):Promise<unknown>{
    if(this.closed)return Promise.reject(new Error('Device disconnected'));
    if(this.pending.size>=MAX_PENDING)return Promise.reject(new Error('Too many Serial requests are pending; wait for a response.'));
    const id=++this.id;
    return new Promise((resolve,reject)=>{const timer=window.setTimeout(()=>{this.pending.delete(id);this.timedOut.add(id);while(this.timedOut.size>128)this.timedOut.delete(this.timedOut.values().next().value!);reject(new Error(`Serial request ${op} timed out`));},REQUEST_TIMEOUT_MS);this.pending.set(id,{resolve,reject,timer,op,params});try{this.transport.send({type:'request',id,op,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e instanceof Error?e:new Error('Send failed'));}});
  }
  async configureChannel(channel:number,config:SerialConfig):Promise<SerialChannel>{const result=await this.request('configure_channel',{channel,config});return (result as {channel:SerialChannel}).channel;}
  async startRx(channels:number[]):Promise<SerialChannel[]>{const result=await this.request('start_rx',{channels});return (result as {channels:SerialChannel[]}).channels;}
  async stopRx(channels:number[]):Promise<SerialChannel[]>{const result=await this.request('stop_rx',{channels});return (result as {channels:SerialChannel[]}).channels;}
  async transmit(channel:number,data:string):Promise<{accepted:true;bytes_accepted:number}>{return await this.request('transmit',{channel,data}) as {accepted:true;bytes_accepted:number};}
  async statistics():Promise<SerialStatisticsResult>{return validateStatistics(await this.request('get_statistics',{}));}
  close(){if(this.closed)return;this.transport.close();this.closedLink({phase:'open',code:1000,reason:'client closing',wasClean:true,initiatedBy:'local'});}
}
