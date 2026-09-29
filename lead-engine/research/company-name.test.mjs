import test from 'node:test';
import assert from 'node:assert/strict';
import {companyNameIsSourced} from './qualified-model.mjs';
const cases=[
  [
    "Schilder-Concurrent B.V.",
    "Schildersbedrijf de Schilder-Concurrent b.v",
    true
  ],
  [
    "Schilder Concurrent BV",
    "Schilder-Concurrent B. V.",
    true
  ],
  [
    "Van  Dijk",
    "Schildersbedrijf Van Dijk",
    true
  ],
  [
    "D’Art",
    "D'Art",
    true
  ],
  [
    "Jansen",
    "Janssen",
    false
  ],
  [
    "ABC",
    "XABC",
    false
  ],
  [
    "ABC",
    "ABCDEF",
    false
  ],
  [
    "Van Dijk",
    "Van Dijkman",
    false
  ],
  [
    "Schilder Concurrent BV",
    "Andere Schilder BV",
    false
  ],
  [
    "",
    "Schildersbedrijf",
    false
  ]
];
for(const [name,quote,expected] of cases){test(`${name} / ${quote}`,()=>assert.equal(companyNameIsSourced(name,quote),expected));}
