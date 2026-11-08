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
    await page.getByLabel('Hex bytes').fill('00 41 ff');await page.getByRole('button',{name:'Send bytes'}).click();await expect(page.getByRole('alert')).toContainText('physical transmission is not confirmed');
    const replaced=await context.newPage();await replaced.goto('/');await replaced.evaluate(async url=>{const ws=new WebSocket(url);await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('open'));});ws.send(JSON.stringify({type:'request',id:1,op:'hello',params:{contract_version:'0.1.0'}}));},device.url);
    await expect(page.getByRole('alert')).toContainText('Another client may have taken over');await replaced.close();
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
    device.inject(1,'00',0,18446744073709551610n,324);await expect(page.getByText(/Source sequence gaps: 3 events/)).toBeVisible();device.recordOverrun(1,3);await page.getByRole('button',{name:'Refresh Serial statistics'}).click();await expect(page.getByLabel('Serial 1 statistics')).toContainText('UART overruns 3');
  }finally{await device.close();}
});

test('explicit disconnect updates the visible session and malformed events close the peer',async({page})=>{
  const device=await new MockSerialServer().ready();try{await openSerial(page,device);await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await armFirstChannel(page);device.inject(1,'zz');await expect(page.getByRole('alert')).toContainText('invalid rx_data event');await expect(page.getByRole('heading',{name:'Connect to a Bridge Serial device'})).toBeVisible();await page.getByRole('button',{name:'Connect Serial'}).click();await expect(page.getByRole('heading',{name:'Serial device: MOCK-SER-01'})).toBeVisible();await page.getByRole('button',{name:'Disconnect Serial'}).click();await expect(page.getByRole('heading',{name:'Connect to a Bridge Serial device'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('Serial device disconnected');}finally{await device.close();}
});
