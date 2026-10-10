'use strict';
const { spawn } = require('child_process');
const { sequelize } = require('../../models');
const Store = require('../../lib/pgRateLimitStore');
const pg = sequelize.getDialect() === 'postgres';
beforeEach(() => globalThis.resetDatabase());
it.skipIf(!pg)('three processes share a single rate limit counter and expiration', async () => {
  const script = `const Store=require('./lib/pgRateLimitStore'); const store=new Store('test120'); store.init({windowMs:60000}); (async()=>{const values=[];for(let i=0;i<10;i++)values.push((await store.increment('client')).totalHits);console.log('RESULT:'+JSON.stringify(values));await require('./config/database').close();})().catch(e=>{console.error(e.message);process.exitCode=1});`;
  function worker() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script], {
        cwd: require('path').resolve(__dirname, '../..'),
        env: process.env,
      });
      let output = '';
      let errors = '';
      child.stdout.on('data', (d) => {
        output += d;
      });
      child.stderr.on('data', (d) => {
        errors += d;
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code) reject(new Error(errors));
        else resolve(JSON.parse(output.split('RESULT:')[1].trim()));
      });
    });
  }
  const counts = (await Promise.all([worker(), worker(), worker()])).flat().sort((a, b) => a - b);
  expect(counts).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  const store = new Store('test120');
  store.init({ windowMs: 60000 });
  await sequelize.models.RateLimitBucket.update({ resetAt: new Date(0) }, { where: {} });
  expect((await store.increment('client')).totalHits).toBe(1);
  await store.resetKey('client');
  expect(await sequelize.models.RateLimitBucket.count()).toBe(0);
});
