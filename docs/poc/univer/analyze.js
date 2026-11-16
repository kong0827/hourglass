const fs = require('fs');
const path = 'D:/project/hourglass/docs/poc/univer/vendor/';
const ui = fs.readFileSync(path + 'ui.js', 'utf8');

function around(t, idx, b, a) {
  return t.slice(Math.max(0, idx - b), idx + a).replace(/\s+/g, ' ');
}

// full Y body
console.log('=== Y full body @35777');
console.log(ui.slice(35777, 35777 + 1200));

// ot (toObservable) def
const ot = ui.indexOf('function ot(');
console.log('\n=== ot def @' + ot);
console.log(ot > 0 ? ui.slice(ot, ot + 400) : around(ui, ui.indexOf('ot='), 60, 400));

// Va def (desktop render fn)
const va = ui.indexOf('function Va(');
console.log('\n=== Va def @' + va);
console.log(ui.slice(va, va + 600));

// La's onRendered effect: search within La body for "useEffect" with M
const laIdx = ui.indexOf('function La(');
const laBody = ui.slice(laIdx, laIdx + 9000);
console.log('\n=== useEffect occurrences in La body');
const ue = [...laBody.matchAll(/useEffect|useLayoutEffect/g)].map(m => ({ i: m.index, name: m[0] }));
for (const u of ue.slice(0, 10)) console.log('  +' + u.i + ' ' + u.name + ': ' + around(laBody, u.i, 30, 260));
