#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { compareReports } from './lib/compareLib.mjs';

const argv=process.argv.slice(2);
const allow=argv.includes('--allow-model-diff');
const files=argv.filter((x)=>!x.startsWith('--'));
if(files.length!==2){
  console.error('usage: node compare.mjs old.json new.json [--allow-model-diff]');
  process.exit(2);
}
const read=(p)=>JSON.parse(fs.readFileSync(path.resolve(p),'utf8'));
const result=compareReports(read(files[0]),read(files[1]),{allowModelDiff:allow});
console.log(JSON.stringify(result,null,2));
if(result.status==='INCOMPATIBLE')process.exit(2);
