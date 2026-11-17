import { test } from 'vitest';
import assert from 'node:assert/strict';
import { modelAdvice } from '../voice/modelHardwareAdvice.ts';
const GiB=1024**3;
const models=[{id:'standard',guidance:{reference_memory_bytes:2*GiB,validation:{state:'passed'}}},
              {id:'small',guidance:{reference_memory_bytes:GiB,validation:{state:'passed'}}}];
const gpu=(free,total=8*GiB,kind='gpu')=>({name:'Vulkan0',kind,description:'GPU',memory_total:total,memory_free:free});
const snapshot=(devices)=>({phase:'ready',devices,measured_at_ms:1000});
const advise=(hardware,extra={})=>modelAdvice(models,hardware,{now:1000,reserveBytes:GiB,...extra});
test('select standard or small using current free memory plus margin, never total alone',()=>{
  assert.equal(advise(snapshot([gpu(4*GiB)])).recommended,'standard');
  assert.equal(advise(snapshot([gpu(2.5*GiB)])).recommended,'small');
  const low=advise(snapshot([gpu(.5*GiB)]));assert.equal(low.recommended,null);assert.equal(low.reason,'low_memory');
});
test('zero free is exhausted; missing/free stale/shared are unknown',()=>{
  assert.equal(advise(snapshot([gpu(0)])).reason,'low_memory');
  assert.equal(advise(snapshot([gpu(null)])).reason,'unknown_memory');
  // An integrated GPU is advised on only when an older version saved it by name.
  assert.equal(advise(snapshot([gpu(4*GiB,8*GiB,'igpu')]),{deviceMode:'Vulkan0'}).reason,'shared_memory');
  assert.equal(advise(snapshot([gpu(4*GiB)]),{now:121001}).reason,'stale');
});
test('does not add GPU memory or recommend the second GPU which runtime will not select',()=>{
  const result=advise(snapshot([gpu(.5*GiB),{...gpu(8*GiB),name:'Vulkan1'}]));
  assert.equal(result.device.name,'Vulkan0');assert.equal(result.recommended,null);assert.equal(result.multiple,true);
});
test('a GPU named in the settings is the one advised on, not the first one listed',()=>{
  // The beta.5 PC: an integrated Vulkan0 listed first, the RTX chosen as Vulkan1.
  const devices=[gpu(16*GiB,16*GiB,'igpu'),{...gpu(4*GiB),name:'Vulkan1'}];
  const chosen=advise(snapshot(devices),{deviceMode:'Vulkan1'});
  assert.equal(chosen.device.name,'Vulkan1');assert.equal(chosen.reason,'fits');assert.equal(chosen.recommended,'standard');
  // auto and gpu run on the separate GPU, never on the integrated one listed first.
  for(const deviceMode of ['auto','gpu']) assert.equal(advise(snapshot(devices),{deviceMode}).device.name,'Vulkan1');
  assert.equal(advise(snapshot(devices),{deviceMode:'Vulkan9'}).device.name,'Vulkan1');
  assert.equal(advise(snapshot([...devices,{name:'CPU',kind:'cpu'}]),{deviceMode:'CPU'}).reason,'cpu');
});
test('CPU mode, unavailable probe and not yet tested variants cannot claim GPU suitability',()=>{
  assert.equal(advise(snapshot([gpu(8*GiB)]),{deviceMode:'cpu'}).reason,'cpu');
  assert.equal(advise(snapshot([{kind:'cpu'}])).reason,'cpu');
  // With only an integrated GPU, auto runs on the CPU.
  assert.equal(advise(snapshot([gpu(4*GiB,8*GiB,'igpu'),{name:'CPU',kind:'cpu'}])).reason,'cpu');
  assert.equal(advise({phase:'failed',devices:[]}).reason,'unknown');
  assert.equal(modelAdvice([{id:'pending',guidance:{reference_memory_bytes:GiB,validation:{state:'pending'}}}],snapshot([gpu(8*GiB)]),{now:1000,reserveBytes:GiB}).recommended,null);
});
