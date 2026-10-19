const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./solver.js');

const G = (g) => Math.round(g * 1000); // grams -> mg
const near = (actualMg, expectedG, msg) =>
  assert.ok(Math.abs(actualMg / 1000 - expectedG) <= 0.01 + 1e-9, `${msg}: ${actualMg / 1000} vs ${expectedG}`);

// fill parts (non-mandatory) as "fineness:mg" for lookup
const fillOf = (o) => o.parts.filter((p) => p.source !== 'mandatory');
const findOption = (res, finenesses) =>
  res.options.find((o) => {
    const f = fillOf(o).map((p) => Math.round(p.fineness));
    return f.length === finenesses.length && finenesses.every((x, i) => f[i] === x);
  });

const lot = (id, g, fineness, mandatory) => ({ id, mg: G(g), fineness, mandatory });

test('1) M=26, T=585, no stock: reference options', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [] });
  assert.equal(res.status, 'ok');
  assert.equal(res.hasStock, false);
  assert.ok(res.options.every((o) => o.section === 'all'));

  const single = findOption(res, [585]);
  near(single.parts[0].mg, 26.0, '585 alone');

  const p750 = findOption(res, [750, 0]);
  near(p750.parts[0].mg, 20.28, '750');
  near(p750.parts[1].mg, 5.72, 'ligature');

  const p999 = findOption(res, [999, 0]);
  assert.equal(S.formatGrams(p999.parts[0].mg), '15.23');
  assert.equal(S.formatGrams(p999.parts[1].mg), '10.77');

  for (const o of res.options) {
    assert.equal(o.check.totalMg, G(26), 'sum is exact');
    assert.ok(o.check.ok, `check ${o.text}`);
  }
  // order: single first, then pairs without 999, then with 999
  assert.equal(res.options[0], single);
  assert.ok(res.options.indexOf(p750) < res.options.indexOf(p999));
  assert.equal(p750.text, '20.28 г золота 750 + 5.72 г лигатуры');
});

test('2) M=26, T=750, 5.55 g of 997 mandatory: 750+585 in "other" section', () => {
  const res = S.solve({ massMg: G(26), target: 750, lots: [lot(1, 5.55, 997, true)] });
  assert.equal(res.status, 'ok');
  assert.equal(res.remainder.mg, G(20.45));
  assert.ok(Math.abs(res.remainder.fineness - 683.0) < 0.1, String(res.remainder.fineness));

  const pair = findOption(res, [750, 585]);
  assert.ok(pair, '750+585 exists');
  assert.equal(pair.section, 'other');
  near(pair.parts[1].mg, 12.14, '750');
  near(pair.parts[2].mg, 8.31, '585');
  assert.equal(pair.parts[0].source, 'mandatory');
  assert.equal(pair.parts[0].mg, G(5.55));
  assert.ok(Math.abs(pair.check.fineness - 750) <= 0.5, String(pair.check.fineness));
  assert.ok(res.options.every((o) => o.check.totalMg === G(26)));
});

test('3) M=26, T=585, 10 g of 750 not mandatory: greyed with shortage, no duplicate reference', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 10, 750, false)] });
  const p750 = findOption(res, [750, 0]);
  assert.equal(p750.feasible, false);
  assert.equal(p750.section, 'short');
  assert.equal(p750.shortageMg, G(10.28));
  assert.ok(p750.note.includes('не хватает 10.28 г'), p750.note);

  // stock 750 replaces reference 750: exactly one 750+ligature option
  assert.equal(res.options.filter((o) => findOption({ options: [o] }, [750, 0])).length, 1);
  // reference section still shows 585 and 999+ligature
  assert.equal(findOption(res, [585]).section, 'other');
  assert.equal(findOption(res, [999, 0]).section, 'other');
  // order: stock -> short -> other
  const order = res.options.map((o) => o.section);
  assert.deepEqual(order, order.slice().sort((a, b) => ({ stock: 0, short: 1, other: 2 })[a] - ({ stock: 0, short: 1, other: 2 })[b]));
});

test('4) M=26, T=585, 26 g of 750 mandatory: dilution', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 26, 750, true)] });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'EXACT_MASS_WRONG_FINENESS');
  assert.ok(res.message.length > 0);
  assert.ok(res.dilution);
  const [gold, lig] = res.dilution.parts;
  near(gold.mg, 20.28, '750');
  near(lig.mg, 5.72, 'ligature');
  assert.equal(lig.source, 'ligature');
  assert.ok(res.dilution.check.ok);
  assert.equal(res.dilution.text, '20.28 г золота 750 + 5.72 г лигатуры');
});

test('5) Screen 2: 10 g 750 + 8 g 585 + 3 g ligature', () => {
  const r = S.mixResult({ rows: [{ mg: G(10), fineness: 750 }, { mg: G(8), fineness: 585 }], ligatureMg: G(3) });
  assert.equal(S.formatGrams(r.totalMg), '21.00');
  assert.equal(S.formatGold(r.goldMg), '12.18');
  assert.equal(S.formatFineness(r.fineness), '580.0');
  assert.equal(S.mixResult({ rows: [], ligatureMg: null }), null);
});

test('6) comma decimal and empty form', () => {
  assert.equal(S.parseNumber('26,5'), 26.5);
  assert.equal(S.parseNumber(' 26.5 '), 26.5);
  assert.equal(S.parseNumber(''), null);
  assert.equal(S.parseNumber('abc'), null);
  assert.equal(S.parseNumber('-3'), null);
  assert.equal(S.parseGrams('26,5'), 26500);
  assert.equal(S.parseGrams('0'), null);
  assert.deepEqual(S.solve({ massMg: null, target: null, lots: [] }), { status: 'empty' });
  assert.deepEqual(S.solve({ massMg: G(26), target: null, lots: [] }), { status: 'empty' });
  assert.deepEqual(S.solve({}), { status: 'empty' });
});

test('mandatory lots give exactly M and T: nothing to add', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 16, 585, true), lot(2, 10, 585, true)] });
  assert.equal(res.status, 'exact');
  assert.ok(res.message.toLowerCase().includes('добавлять ничего не нужно'), res.message);
  assert.ok(res.check.ok);
});

test('fineness outside 1..999 is empty input with a hint', () => {
  assert.deepEqual(S.parseFineness(''), { value: null, error: null });
  assert.equal(S.parseFineness('997').value, 997);
  assert.equal(S.parseFineness('583,3').value, 583.3);
  for (const bad of ['0', '1000', '1500']) {
    const r = S.parseFineness(bad);
    assert.equal(r.value, null);
    assert.equal(r.error, 'Проба от 1 до 999');
  }
  assert.deepEqual(S.solve({ massMg: G(26), target: 1000, lots: [] }), { status: 'empty' });
  // a row with invalid fineness is ignored: no stock -> reference mode
  const res = S.solve({ massMg: G(26), target: 585, lots: [{ id: 1, mg: G(5), fineness: 0, mandatory: true }] });
  assert.equal(res.hasStock, false);
});

test('non-mandatory lots of the same fineness merge into one limited material', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 5, 750, false), lot(2, 5, 750, false)] });
  const opts750 = res.options.filter((o) => fillOf(o).some((p) => Math.round(p.fineness) === 750));
  assert.equal(opts750.length, 1, 'no 750+750 pair');
  assert.equal(opts750[0].shortageMg, G(10.28));
});

test('mandatory lots of the same fineness are subtracted separately', () => {
  const res = S.solve({ massMg: G(26), target: 750, lots: [lot(1, 3, 997, true), lot(2, 2.55, 997, true)] });
  const pair = findOption(res, [750, 585]);
  assert.equal(pair.parts.filter((p) => p.source === 'mandatory').length, 2);
  near(pair.parts[2].mg, 12.14, '750');
  near(pair.parts[3].mg, 8.31, '585');
});

test('stock feasible option is listed first', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 30, 750, false)] });
  const first = res.options[0];
  assert.equal(first.section, 'stock');
  assert.equal(first.text, '20.28 г золота 750 + 5.72 г лигатуры');
});

test('mandatory sum greater than M: message + dilution', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 30, 750, true)] });
  assert.equal(res.code, 'MANDATORY_EXCEEDS_MASS');
  near(res.dilution.parts[0].mg, 20.28, '750');
  near(res.dilution.parts[1].mg, 5.72, 'ligature');
});

test('too much gold in mandatory lots (G_rem < 0): dilution', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 20, 999, true)] });
  assert.equal(res.code, 'TOO_MUCH_GOLD');
  assert.equal(S.formatGrams(res.dilution.parts[0].mg), '15.23');
  assert.equal(S.formatGrams(res.dilution.parts[1].mg), '10.77');
});

test('mandatory lots too poor (F_rem > 999): message, no dilution', () => {
  const res = S.solve({ massMg: G(26), target: 750, lots: [lot(1, 20, 585, true)] });
  assert.equal(res.code, 'FINENESS_UNREACHABLE');
  assert.equal(res.dilution, null);
});

test('ligature with non-zero fineness', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [], ligatureFineness: 10 });
  const p = findOption(res, [750, 10]);
  assert.ok(p.check.ok);
  near(p.parts[0].mg, (26 * (585 - 10)) / (750 - 10), '750');
});

test('history: same input moves to the top, max 20', () => {
  let h = [];
  for (let i = 0; i < 25; i++) h = S.addToHistory(h, { key: 'k' + i });
  assert.equal(h.length, 20);
  assert.equal(h[0].key, 'k24');
  h = S.addToHistory(h, { key: 'k10', ts: 1 });
  assert.equal(h.length, 20);
  assert.equal(h[0].key, 'k10');
  assert.equal(h.filter((e) => e.key === 'k10').length, 1);
});

test('formatting uses integer math', () => {
  assert.equal(S.formatGrams(15225), '15.225');
  assert.equal(S.formatGrams(15230), '15.23');
  assert.equal(S.formatGrams(5), '0.005');
  assert.equal(S.formatGrams(26000), '26.00');
  assert.equal(S.formatFinenessShort(750), '750');
  assert.equal(S.formatFinenessShort(583.33), '583.3');
});

test('results header shows real mass and target', () => {
  assert.equal(S.resultsTitle(G(26), 585), 'Что взять для плавки (на 26 г, проба 585)');
  assert.equal(S.resultsTitle(G(26.5), 750), 'Что взять для плавки (на 26.5 г, проба 750)');
  assert.equal(S.formatGramsShort(G(26.55)), '26.55');
  assert.equal(S.formatGramsShort(G(30)), '30');
});

test('empty stock rows are ignored by the calculation', () => {
  const emptyRows = [
    { id: 1, mg: null, fineness: null, mandatory: false },
    { id: 2, mg: G(5), fineness: null, mandatory: false },
    { id: 3, mg: null, fineness: 750, mandatory: true },
  ];
  const withEmpty = S.solve({ massMg: G(26), target: 585, lots: emptyRows });
  const without = S.solve({ massMg: G(26), target: 585, lots: [] });
  assert.equal(withEmpty.hasStock, false);
  assert.deepEqual(withEmpty.options.map((o) => o.text), without.options.map((o) => o.text));
});

test('whole lot of manual fineness (850) is completed with 585/750/999 + ligature', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 15, 850, true)] });
  assert.equal(res.status, 'ok');
  assert.equal(res.hasFreeStock, false, 'whole-lot rows alone are not stock to pick from');
  assert.ok(Math.abs(res.remainder.fineness - 223.6) < 0.1, String(res.remainder.fineness));
  const p585 = findOption(res, [585, 0]);
  assert.equal(p585.parts[0].mg, G(15));
  assert.equal(S.formatGrams(p585.parts[1].mg), '4.21');
  assert.equal(S.formatGrams(p585.parts[2].mg), '6.79');
  assert.ok(findOption(res, [750, 0]) && findOption(res, [999, 0]));
  assert.ok(res.options.every((o) => o.check.ok && o.check.totalMg === G(26)));
});

test('several whole lots over the mass: cut one lot, keep the others whole', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 10, 750, true), lot(2, 20, 585, true)] });
  assert.equal(res.code, 'MANDATORY_EXCEEDS_MASS');
  assert.equal(res.dilutions.length, 2);
  for (const d of res.dilutions) {
    assert.equal(d.parts.filter((p) => p.source === 'lot').length, 1, 'exactly one lot is cut');
    assert.equal(d.skipped.length, 0);
    assert.ok(d.check.ok);
    assert.equal(d.check.totalMg, G(26));
  }
  const [best, second] = res.dilutions;
  assert.deepEqual(best.parts.map((p) => [p.source, p.mg]), [['mandatory', G(20)], ['lot', G(4.68)], ['ligature', G(1.32)]]);
  assert.equal(best.parts[1].cutFromMg, G(10));
  assert.deepEqual(second.parts.map((p) => [p.source, p.mg]), [['mandatory', G(10)], ['lot', G(13.18)], ['ligature', G(2.82)]]);
  assert.equal(res.dilution, best);
});

test('too much gold even after cutting any one lot: leave a lot out, never split all lots', () => {
  const res = S.solve({ massMg: G(26), target: 585, lots: [lot(1, 10, 999, true), lot(2, 10, 999, true), lot(3, 10, 585, true)] });
  assert.ok(res.dilutions.length >= 1);
  for (const d of res.dilutions) {
    assert.equal(d.skipped.length, 1);
    assert.equal(d.parts.filter((p) => p.source === 'lot').length, 1);
    assert.ok(d.check.ok, d.check.text);
    assert.equal(d.check.totalMg, G(26));
  }
  // equal lots (two 10 g of 999) do not produce duplicate cards
  assert.equal(new Set(res.dilutions.map((d) => d.text)).size, res.dilutions.length);
});

test('fuzz: never NaN, never negative or zero grams, sums are exact', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const fins = [375, 500, 585, 750, 875, 916, 958, 997, 999];
  for (let i = 0; i < 3000; i++) {
    const massMg = 1000 + Math.floor(rnd() * 60000);
    const target = [375, 585, 750, 916][Math.floor(rnd() * 4)];
    const n = Math.floor(rnd() * 4);
    const lots = [];
    for (let k = 0; k < n; k++) {
      lots.push({ id: k, mg: 100 + Math.floor(rnd() * 30000), fineness: fins[Math.floor(rnd() * fins.length)], mandatory: rnd() < 0.4 });
    }
    const L = rnd() < 0.2 ? 5 : 0;
    const res = S.solve({ massMg, target, lots, ligatureFineness: L });
    const cards = res.status === 'ok' ? res.options : res.status === 'error' ? res.dilutions : res.status === 'exact' ? [res] : [];
    for (const c of cards) {
      for (const p of c.parts) {
        assert.ok(Number.isInteger(p.mg) && p.mg > 0, `bad part ${JSON.stringify(p)} in ${JSON.stringify({ massMg, target, lots })}`);
        assert.ok(Number.isFinite(p.fineness));
      }
      assert.equal(c.check.totalMg, massMg);
      assert.ok(Number.isFinite(c.check.fineness));
      assert.ok(!c.text.includes('NaN') && !c.text.includes('-'), c.text);
    }
    if (res.status === 'ok') assert.ok(Number.isFinite(res.remainder.fineness));
    if (res.status === 'error') assert.ok(!res.message.includes('NaN'), res.message);
  }
});
