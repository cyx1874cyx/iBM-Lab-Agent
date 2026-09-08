import {test} from "node:test";
import assert from "node:assert/strict";
import {resolveCompoundFirst} from "../../src/synthesis/compound-resolve.js";
test("first source resolves without waiting for a stuck second source",async()=>{let calls=0;const result=await resolveCompoundFirst("ethanol",{pubchem:async()=>({smiles:"CCO",casNumber:"64-17-5"}),cactus:()=>{calls++;return new Promise(()=>{});},timeoutMs:30});assert.equal(result.smiles,"CCO");assert.equal(result.status,"single-source");assert.equal(result.casNumber,"64-17-5");assert.equal(calls,1);});
test("fallback, CAS-only and unresolved responses remain usable",async()=>{const bad=async()=>{throw Error("offline");};assert.equal((await resolveCompoundFirst("x",{pubchem:bad,cactus:async()=>({smiles:"CC"})})).source,"cactus");assert.equal((await resolveCompoundFirst("64-17-5",{pubchem:bad,cactus:bad})).casNumber,"64-17-5");assert.equal((await resolveCompoundFirst("x",{pubchem:bad,cactus:bad})).status,"unresolved");});
