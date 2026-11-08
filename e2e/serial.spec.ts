import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MockSerialServer } from './mockSerialServer';

async function openSerial(page:Page,device:MockSerialServer){
  await page.goto('/');await page.getByRole('button',{name:'Add a device'}).click();await page.getByRole('button',{name:'Choose Bridge Serial'}).click();await page.getByRole('button',{name:'Open Serial session'}).click();
  await page.getByLabel('Device address').fill(device.url);await page.getByRole('button',{name:'Connect Serial'}).click();
}
async function armFirstChannel(page:Page){const c=page.locator('fieldset').filter({hasText:'Serial 1'});await c.getByRole('button',{name:'Apply Serial 1 configuration'}).click();await c.getByRole('button',{name:'Start Serial 1 RX'}).click();await expect(c).toContainText('RX active');}

test('Bridge Serial configures channels, preserves numeric u64, loss-only events and transmits bytes',async({page,context})=>{
  const device=await new MockSerialServer().ready();try{
    await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
    const c1=page.locator('fieldset').filter({hasText:'Serial 1'});const c2=page.locator('fieldset').filter({hasText:'Serial 2'});
    await c1.getByLabel('Mode').selectOption('rs485');await c1.getByLabel('Baud').selectOption('115200');await c1.getByLabel('RS-485 fail-safe bias').check();await c1.getByRole('button',{name:'Apply Serial 1 configuration'}).click();
    await c2.getByLabel('Mode').selectOption('rs232');await c2.getByLabel('Baud').selectOption('9600');await c2.getByRole('button',{name:'Apply Serial 2 configuration'}).click();
    await c1.getByRole('button',{name:'Start Serial 1 RX'}).click();await expect(c1).toContainText('RX active');
    device.inject(1);await expect(page.getByRole('list',{name:'Serial byte events'})).toContainText('18446744073709551000 ns');await expect(page.getByRole('list',{name:'Serial byte events'})).toContainText('dropped 2 bytes');
    device.inject(1,'',7,18446744073709551001n);await expect(page.getByRole('list',{name:'Serial byte events'})).toContainText('(loss-only event)');
    await page.getByRole('button',{name:'Close this pane'}).click();await expect(page.getByText(/Bridge Serial session connected to MOCK-SER-01/)).toBeVisible();await page.getByRole('button',{name:'Open Serial session'}).click();
    await page.getByLabel('Hex bytes').fill('00 41 ff');await page.getByRole('button',{name:'Send bytes'}).click();await expect(page.getByRole('status').filter({hasText:'physical transmission is not confirmed'})).toBeVisible();
    const replaced=await context.newPage();await replaced.goto('/');await replaced.evaluate(async url=>{const ws=new WebSocket(url);await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('open'));});ws.send(JSON.stringify({type:'request',id:1,op:'hello',params:{contract_version:'0.1.0'}}));},device.url);
    await expect(page.getByRole('alert')).toContainText('Another client took over');await replaced.close();
  }finally{await device.close();}
});

test('rejects a v0.1 descriptor that omits a mandated channel',async({page})=>{
  const device=await new MockSerialServer().ready();device.descriptorChannels=1;try{await openSerial(page,device);await expect(page.getByRole('alert')).toContainText('invalid descriptor');}finally{await device.close();}
});

test('rejects duplicate capabilities, out-of-range rates, and an effective config outside advertised rates',async({page})=>{
  const duplicate=await new MockSerialServer().ready();duplicate.supportedModes=['rs232','rs232','rs485'];try{await openSerial(page,duplicate);await expect(page.getByRole('alert')).toContainText('descriptor capabilities');}finally{await duplicate.close();}
  const invalidRate=await new MockSerialServer().ready();invalidRate.supportedRates=[9600,19200,38400,57600,115200,1000000,2000000];try{await openSerial(page,invalidRate);await expect(page.getByRole('alert')).toContainText('descriptor capabilities');}finally{await invalidRate.close();}
  const invalidConfig=await new MockSerialServer().ready();invalidConfig.channels[0]!.config={mode:'rs232',baud_rate:4800,data_bits:8,parity:'none',stop_bits:1,termination:false,bias:false};try{await openSerial(page,invalidConfig);await expect(page.getByRole('alert')).toContainText('channel config exceeds advertised capabilities');}finally{await invalidConfig.close();}
});

test('accepts a compatible 0.1 patch version and rejects an unsupported minor version',async({page})=>{
  const device=await new MockSerialServer().ready();device.contractVersion='0.1.7';try{await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();}finally{await device.close();}
  const other=await new MockSerialServer().ready();other.contractVersion='0.2.0';try{await openSerial(page,other);await expect(page.getByRole('alert')).toContainText('unsupported contract version');}finally{await other.close();}
});

test('accepts both descriptor channel orders and presents channels in numeric order',async({page})=>{
  const device=await new MockSerialServer().ready();device.reverseChannels=true;try{await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await expect(page.locator('fieldset').first()).toContainText('Serial 1');}finally{await device.close();}
});

test('bounds rendered Serial rows and reports source gaps and unknown-count overruns',async({page})=>{
  const device=await new MockSerialServer().ready();try{await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await armFirstChannel(page);for(let i=0;i<320;i++)device.inject(1,'ff',0,18446744073709551000n+BigInt(i),i+1);await expect(page.getByRole('list',{name:'Serial byte events'}).locator('li')).toHaveCount(300);await expect(page.getByText(/trace evictions: 20 rows/)).toBeVisible();
    device.inject(1,'00',0,18446744073709551610n,324);await expect(page.getByText(/source sequence gaps: 3 events/i)).toBeVisible();device.recordOverrun(1,3);await page.getByRole('button',{name:'Refresh Serial statistics'}).click();await expect(page.getByRole('region',{name:'Device statistics'})).toContainText('UART overruns 3');
  }finally{await device.close();}
});

test('explicit disconnect updates the visible session and malformed events close the peer',async({page})=>{
  const device=await new MockSerialServer().ready();try{await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await armFirstChannel(page);device.inject(1,'zz');await expect(page.getByRole('alert')).toContainText('Serial protocol error: Serial protocol: invalid rx_data event');await expect(page.getByRole('heading',{name:'Connect to a Bridge Serial device'})).toBeVisible();await page.getByRole('button',{name:'Connect Serial'}).click();await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await page.getByRole('button',{name:'Disconnect Serial'}).click();await expect(page.getByRole('heading',{name:'Connect to a Bridge Serial device'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('Serial device disconnected');}finally{await device.close();}
});

test('switches back to Bridge CAN from the Bridge Serial chooser',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Add a device'}).click();
  await page.getByRole('button',{name:'Choose Bridge Serial'}).click();
  await expect(page.getByRole('button',{name:'Open Serial session'})).toBeVisible();
  await page.getByRole('button',{name:'Choose Bridge CAN'}).click();
  await expect(page.getByRole('button',{name:'Open Serial session'})).toHaveCount(0);
  await expect(page.getByTestId('permission-explainer')).toBeVisible();
});

test('a device-side abnormal close reports connection loss and allows manual reconnect',async({page})=>{
  const device=await new MockSerialServer().ready();try{
    await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
    device.closeCurrent(1006);
    await expect(page.getByRole('alert')).toContainText('connection was lost');
    await expect(page.getByRole('alert')).not.toContainText('took over');
    await page.getByRole('button',{name:'Connect Serial'}).click();
    await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
  }finally{await device.close();}
});

test('flushes received Serial data already queued in the browser when the device disconnects',async({page})=>{
  const device=await new MockSerialServer().ready();try{
    await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await armFirstChannel(page);
    device.injectThenClose(1,'dead');
    await expect(page.getByRole('alert')).toContainText('close code 4002');
    await page.getByRole('button',{name:'Connect Serial'}).click();await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
    await expect(page.getByRole('list',{name:'Serial byte events'})).toContainText('dead');
  }finally{await device.close();}
});

test('UART overrun becomes a live loss indicator and a trace marker without Refresh',async({page})=>{
  const device=await new MockSerialServer().ready();try{
    await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
    await expect(page.getByRole('region',{name:'Device statistics'})).toContainText('UART overruns 0');
    device.recordOverrun(1,2);
    await expect(page.getByText(/UART overruns observed: 2 events.*byte count may be unknown/i)).toBeVisible({timeout:7000});
    await expect(page.getByRole('alert')).toContainText('UART data loss detected');
    await expect(page.getByRole('list',{name:'Serial byte events'})).toContainText(/UART overrun detected on Serial 1.*byte count unknown/i);
  }finally{await device.close();}
});

test('reconnect preserves known loss counters and explains possible queue loss',async({page})=>{
  const device=await new MockSerialServer().ready();try{
    await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await armFirstChannel(page);
    await expect(page.getByRole('region',{name:'Device statistics'})).toContainText('UART overruns 0');
    device.recordOverrun(1,2);await expect(page.getByText(/UART overruns observed: 2 events/)).toBeVisible({timeout:7000});
    device.inject(1,'aa',3,18446744073709551000n,1);
    await expect(page.getByText(/reported device byte loss: 3/)).toBeVisible();
    device.closeCurrent(1006);await expect(page.getByRole('alert')).toContainText('connection was lost');
    await page.getByRole('button',{name:'Connect Serial'}).click();await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
    await expect(page.getByText(/reported device byte loss: 3/)).toBeVisible();
    await expect(page.getByText(/unread device queue data may also have been lost/i)).toBeVisible();
    await expect(page.getByText(/UART overruns observed: 2 events/)).toBeVisible();
    device.recordOverrun(1,1);await expect(page.getByText(/UART overruns observed: 3 events/)).toBeVisible({timeout:7000});
  }finally{await device.close();}
});

test('tracks another device separately while keeping page-session overrun totals explicit',async({page})=>{
  const first=await new MockSerialServer().ready();const second=await new MockSerialServer().ready();second.deviceId='MOCK-SER-02';try{
    await openSerial(page,first);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await armFirstChannel(page);first.inject(1,'aa',0,18446744073709551000n,5);
    await expect(page.getByRole('region',{name:'Device statistics'})).toContainText('UART overruns 0');
    first.recordOverrun(1,2);await expect(page.getByText(/UART overruns observed: 2 events/)).toBeVisible({timeout:7000});
    first.closeCurrent(1006);await expect(page.getByRole('alert')).toContainText('connection was lost');
    await page.getByLabel('Device address').fill(second.url);await page.getByRole('button',{name:'Connect Serial'}).click();
    await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-02'})).toBeVisible();
    await expect(page.getByRole('list',{name:'Serial byte events'})).toContainText('Device changed from MOCK-SER-01 to MOCK-SER-02');
    await expect(page.getByText(/UART overruns observed: 2 events/)).toBeVisible();
    await armFirstChannel(page);second.inject(1,'bb',0,18446744073709551000n,1000);
    await expect(page.getByRole('list',{name:'Serial byte events'})).toContainText('bb');
    await expect(page.getByText(/source sequence gaps: 0 events/i)).toBeVisible();
    second.recordOverrun(2,1);await expect(page.getByText(/UART overruns observed: 3 events/)).toBeVisible({timeout:7000});
  }finally{await first.close();await second.close();}
});

test('stopped channels reject mock RX injection instead of silently dropping the test event',async({page})=>{
  const device=await new MockSerialServer().ready();try{
    await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
    expect(()=>device.inject(1)).toThrow(/channel 1 is stopped/);
  }finally{await device.close();}
});

test('transmit success is a polite status, payload size is capped, and the trace has a named section',async({page})=>{
  const device=await new MockSerialServer().ready();try{
    await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();
    await armFirstChannel(page);
    const trace=page.getByRole('region',{name:'Serial byte stream'});await expect(trace).toBeVisible();
    const summary=trace.locator('p').filter({hasText:'Source sequence gaps'});await expect(summary).toBeVisible();await expect(summary).not.toHaveAttribute('role','status');await expect(summary).not.toHaveAttribute('aria-live');
    const txLimit=Math.floor((4096-JSON.stringify({type:'request',id:Number.MAX_SAFE_INTEGER,op:'transmit',params:{channel:1,data:''}}).length)/2);
    await page.getByLabel('Hex bytes').fill('aa'.repeat(txLimit));await page.getByRole('button',{name:'Send bytes'}).click();
    const success=page.getByRole('status').filter({hasText:'physical transmission is not confirmed'});await expect(success).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const statusBefore=await success.textContent();
    device.inject(1,'fe',0,18446744073709551000n,1);
    await expect(trace.getByRole('list',{name:'Serial byte events'})).toContainText('fe');
    await expect(success).toHaveText(statusBefore!);
    await page.getByLabel('Hex bytes').fill('aa'.repeat(txLimit+1));await page.getByRole('button',{name:'Send bytes'}).click();
    await expect(page.getByRole('alert')).toContainText('exceeds the 4096-byte request limit');
  }finally{await device.close();}
});
