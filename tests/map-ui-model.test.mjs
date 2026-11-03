import test from 'node:test';
import assert from 'node:assert/strict';
import {canChangeDeliveryAddress,canPublishLocation,decodeMessageAttempt,locationFreshness} from '../apps/web/src/features/delivery-tracking/model.ts';
import {decodeContact,decodeAttempt} from '../apps/web/src/entities/cart/model.ts';
import {geoPoint,navigationUrl} from '../apps/web/src/shared/lib/geo.ts';
import {validateLocations} from '../scripts/locations.mjs';
import fs from 'node:fs/promises';

test('map UI: coordinate pair validation never invents a missing or invalid point',()=>{
  for(const pair of [[null,30],[50,null],[NaN,30],[50,Infinity],[91,30],[50,-181],['50',30]])assert.equal(geoPoint(...pair),null);
  assert.deepEqual(geoPoint(0,0),{latitude:0,longitude:0});
  const route=new URL(navigationUrl({latitude:50.45,longitude:30.52},{latitude:50.44,longitude:30.51}));
  assert.equal(route.searchParams.get('destination'),'50.45,30.52');
  assert.equal(route.searchParams.get('origin'),'50.44,30.51');
});
test('map UI: address editing stops after pickup; GPS ages and publishes with a bounded interval',()=>{
  assert.equal(canChangeDeliveryAddress('створено',null),true);
  assert.equal(canChangeDeliveryAddress('готується',null),true);
  for(const status of ['в дорозі','доставлено','скасовано'])assert.equal(canChangeDeliveryAddress(status,null),false);
  assert.equal(canChangeDeliveryAddress('готується',2),false);
  const at='2026-11-02T12:00:00Z',time=Date.parse(at);
  assert.equal(locationFreshness(at,time+120000),'fresh');
  assert.equal(locationFreshness(at,time+120001),'stale');
  assert.equal(locationFreshness(at,time-120000),'missing');
  assert.equal(locationFreshness('invalid',time),'missing');
  assert.equal(canPublishLocation(100,15099),false);
  assert.equal(canPublishLocation(100,15100),true);
});
test('map UI: restored checkout preserves its exact selected point and rejects malformed geometry',()=>{
  const body={full_name:'Одержувач',phone:'+380000000001',delivery_address:'Київ, Хрещатик, 22',delivery_note:'',payment_method:'готівка',delivery_latitude:50.45,delivery_longitude:30.52,request_key:'a'.repeat(64),restaurant_id:1,expected_total:'100.00',items:[{menu_item_id:1,quantity:1}]};
  const attempt={body,revision:'00000000-0000-4000-8000-000000000001',restaurantName:'Заклад',lines:[{name:'Страва',quantity:1,unitPrice:'100.00'}]};
  assert.equal(decodeContact(JSON.stringify(body)).delivery_longitude,30.52);
  assert.equal(decodeAttempt(JSON.stringify(attempt)).body.delivery_latitude,50.45);
  assert.equal(decodeAttempt(JSON.stringify({...attempt,body:{...body,delivery_longitude:999}})),null);
  const {delivery_latitude,delivery_longitude,...legacy}=body;
  assert.equal(Object.hasOwn(decodeAttempt(JSON.stringify({...attempt,body:legacy})).body,'delivery_latitude'),false);
});
test('map UI: unknown message result restores the same request key, sender and text',()=>{
  const value={sender:'courier',body:'Зустрінемось біля входу',request_key:'12345678-1234-4234-8234-123456789012',courier_id:3};
  assert.deepEqual(decodeMessageAttempt(JSON.stringify(value)),value);
  assert.equal(decodeMessageAttempt(JSON.stringify({...value,courier_id:0})),null);
  assert.equal(decodeMessageAttempt(JSON.stringify({...value,sender:'admin'})),null);
  assert.equal(decodeMessageAttempt(JSON.stringify({...value,body:' '.repeat(3)})),null);
});
test('map catalog: every source branch has exactly one sourced point at its unchanged real address',async()=>{
  const catalog=JSON.parse(await fs.readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
  const locations=JSON.parse(await fs.readFile(new URL('../data/restaurant-locations.json',import.meta.url),'utf8'));
  validateLocations(locations);
  assert.equal(locations.restaurants.length,catalog.restaurants.length);
  for(const branch of catalog.restaurants){const matches=locations.restaurants.filter(row=>row.catalog_key===branch.catalog_key&&row.address===branch.address);assert.equal(matches.length,1);assert.ok(matches[0].latitude>50.3&&matches[0].latitude<50.6);assert.ok(matches[0].longitude>30.3&&matches[0].longitude<30.7);}
  assert.throws(()=>validateLocations({...locations,restaurants:[locations.restaurants[0],locations.restaurants[0]]}));
});
