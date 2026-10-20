// Alloy calculator math. Pure functions, no DOM.
// Works as a plain <script> (window.AlloySolver) and as a CommonJS module (Node).
// Masses are integer milligrams, fineness is permille (parts per 1000).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlloySolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOL = 0.5; // permille tolerance for "same fineness" and the check line
  const MIN_FINENESS = 1;
  const MAX_FINENESS = 999;
  const REFERENCE_FINENESS = [585, 750, 999];
  const HISTORY_MAX = 20;

  // ---------- parsing / formatting ----------

  // "26,5" -> 26.5; "" / "abc" / "-1" -> null
  function parseNumber(str) {
    if (str === null || str === undefined) return null;
    const s = String(str).replace(/\s+/g, '').replace(',', '.');
    if (s === '' || !/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // grams string -> positive integer mg, or null for empty/zero/invalid
  function parseGrams(str) {
    const n = parseNumber(str);
    if (n === null) return null;
    const mg = Math.round(n * 1000);
    return mg > 0 ? mg : null;
  }

  // fineness string -> { value, error }; out of 1..999 counts as empty input with a hint
  function parseFineness(str) {
    const raw = str === null || str === undefined ? '' : String(str).trim();
    if (raw === '') return { value: null, error: null };
    const n = parseNumber(raw);
    if (n === null) return { value: null, error: 'Введите число' };
    if (n < MIN_FINENESS || n > MAX_FINENESS) return { value: null, error: 'Проба от 1 до 999' };
    return { value: n, error: null };
  }

  // ligature fineness setting: 0..999, empty -> 0
  function parseLigatureFineness(str) {
    const n = parseNumber(str);
    if (n === null || n > MAX_FINENESS) return 0;
    return n;
  }

  function gramsToMg(g) {
    return Math.round(g * 1000);
  }

  function round10(mg) {
    return Math.round(mg / 10) * 10;
  }

  // 20280 -> "20.28"; amounts that are not whole centigrams keep 3 decimals so sums stay exact
  function formatGrams(mg) {
    const v = Math.round(mg);
    const sign = v < 0 ? '-' : '';
    const a = Math.abs(v);
    if (a % 10 === 0) {
      const cg = a / 10;
      return sign + Math.floor(cg / 100) + '.' + String(cg % 100).padStart(2, '0');
    }
    return sign + Math.floor(a / 1000) + '.' + String(a % 1000).padStart(3, '0');
  }

  // 26000 -> "26", 26500 -> "26.5", 26550 -> "26.55" (labels, not recipes)
  function formatGramsShort(mg) {
    return formatGrams(mg).replace(/\.?0+$/, '');
  }

  // fractional mg (e.g. pure gold content) -> grams rounded to 0.01
  function formatGold(mg) {
    return formatGrams(round10(mg));
  }

  function formatFineness(f) {
    return (Math.round(f * 10) / 10).toFixed(1);
  }

  // 750 -> "750", 583.3 -> "583.3"
  function formatFinenessShort(f) {
    const r = Math.round(f * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  function sameFineness(a, b) {
    return Math.abs(a - b) <= TOL;
  }

  // ---------- building blocks ----------

  function sumMg(items) {
    return items.reduce((s, x) => s + x.mg, 0);
  }

  function goldOf(items) {
    return items.reduce((s, x) => s + (x.mg * x.fineness) / 1000, 0);
  }

  function blendFineness(items) {
    const total = sumMg(items);
    return total > 0 ? (goldOf(items) / total) * 1000 : 0;
  }

  // keep only complete rows: mg > 0 and fineness within 1..999
  function validLots(lots) {
    return (lots || []).filter(
      (l) =>
        Number.isInteger(l.mg) && l.mg > 0 &&
        Number.isFinite(l.fineness) && l.fineness >= MIN_FINENESS && l.fineness <= MAX_FINENESS
    );
  }

  function splitMandatory(lots) {
    return {
      mandatory: lots.filter((l) => l.mandatory),
      available: lots.filter((l) => !l.mandatory),
    };
  }

  // R, G_rem, F_rem: what is left to add after the mandatory lots
  function remainder(massMg, target, mandatory) {
    const mg = massMg - sumMg(mandatory);
    const goldMg = (massMg * target) / 1000 - goldOf(mandatory);
    const fineness = mg > 0 ? (goldMg / mg) * 1000 : null;
    return { mg, goldMg, fineness };
  }

  // Fill materials: available lots merged by fineness (limited), reference finenesses
  // not covered by stock (unlimited), and ligature (unlimited).
  function buildPool(available, ligatureFineness, hasStock) {
    const sorted = available.slice().sort((a, b) => a.fineness - b.fineness);
    const groups = [];
    for (const lot of sorted) {
      const last = groups[groups.length - 1];
      if (last && sameFineness(last.lots[0].fineness, lot.fineness)) last.lots.push(lot);
      else groups.push({ lots: [lot] });
    }
    const pool = groups.map((g) => ({
      fineness: blendFineness(g.lots),
      limitMg: sumMg(g.lots),
      source: 'stock',
      lotIds: g.lots.map((l) => l.id),
    }));
    for (const f of REFERENCE_FINENESS) {
      if (hasStock && pool.some((m) => sameFineness(m.fineness, f))) continue;
      if (sameFineness(f, ligatureFineness)) continue;
      pool.push({ fineness: f, limitMg: Infinity, source: 'reference', lotIds: [] });
    }
    pool.push({ fineness: ligatureFineness, limitMg: Infinity, source: 'ligature', lotIds: [] });
    return pool;
  }

  // a = R*(F - fB)/(fA - fB); the higher-fineness part is rounded to 0.01 g, the other is the remainder
  function splitPair(Rmg, F, fA, fB) {
    const aMg = round10((Rmg * (F - fB)) / (fA - fB));
    return { aMg, bMg: Rmg - aMg };
  }

  function checkLine(parts, target) {
    const totalMg = sumMg(parts);
    const goldMg = goldOf(parts);
    const fineness = totalMg > 0 ? (goldMg / totalMg) * 1000 : 0;
    return {
      goldMg,
      totalMg,
      fineness,
      ok: Math.abs(fineness - target) <= TOL,
      text: formatGold(goldMg) + ' г / ' + formatGrams(totalMg) + ' г = ' + formatFineness(fineness),
    };
  }

  function partText(p) {
    const g = formatGrams(p.mg) + ' г';
    if (p.source === 'ligature') return g + ' лигатуры';
    return g + ' золота ' + formatFinenessShort(p.fineness) + (p.wholeLot ? ' (весь лот)' : '');
  }

  function recipeText(parts) {
    return parts.map(partText).join(' + ');
  }

  function mandatoryParts(mandatory) {
    return mandatory.map((l) => ({
      fineness: l.fineness,
      mg: l.mg,
      source: 'mandatory',
      wholeLot: true,
      lotIds: [l.id],
    }));
  }

  // fill: [{ material, mg }]
  function makeOption(fill, mandatory, target) {
    const fillParts = fill
      .map(({ material, mg }) => ({
        fineness: material.fineness,
        mg,
        source: material.source,
        wholeLot: false,
        limitMg: material.limitMg,
        lotIds: material.lotIds,
      }))
      .sort((a, b) => b.fineness - a.fineness);
    const parts = mandatoryParts(mandatory).concat(fillParts);
    const shortages = fillParts
      .filter((p) => p.mg > p.limitMg)
      .map((p) => ({ fineness: p.fineness, mg: p.mg - p.limitMg }));
    return {
      parts,
      fillCount: fillParts.length,
      feasible: shortages.length === 0,
      shortages,
      shortageMg: shortages.reduce((s, x) => s + x.mg, 0),
      reference: fillParts.some((p) => p.source === 'reference'),
      uses999: fillParts.some((p) => p.source !== 'ligature' && sameFineness(p.fineness, 999)),
      note: shortages
        .map((s) => 'не хватает ' + formatGrams(s.mg) + ' г (проба ' + formatFinenessShort(s.fineness) + ')')
        .join(', '),
      check: checkLine(parts, target),
      text: recipeText(parts),
    };
  }

  // every single material with fineness == F_rem and every pair fA > F_rem > fB
  function enumerateOptions(rem, pool, mandatory, target) {
    const R = rem.mg;
    const F = rem.fineness;
    const options = [];
    for (const m of pool) {
      if (sameFineness(m.fineness, F)) options.push(makeOption([{ material: m, mg: R }], mandatory, target));
    }
    for (const A of pool) {
      for (const B of pool) {
        if (!(A.fineness - F > TOL && F - B.fineness > TOL)) continue;
        const { aMg, bMg } = splitPair(R, F, A.fineness, B.fineness);
        if (aMg <= 0 || bMg <= 0) continue; // degenerate after rounding: covered by a single
        options.push(makeOption([{ material: A, mg: aMg }, { material: B, mg: bMg }], mandatory, target));
      }
    }
    return options;
  }

  const SECTION_ORDER = { all: 0, stock: 0, short: 1, other: 2 };

  function sortOptions(options) {
    const topF = (o) => Math.max(...o.parts.filter((p) => p.source !== 'mandatory').map((p) => p.fineness));
    const lowF = (o) => Math.min(...o.parts.filter((p) => p.source !== 'mandatory').map((p) => p.fineness));
    return options.slice().sort(
      (a, b) =>
        SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
        a.fillCount - b.fillCount ||
        Number(a.uses999) - Number(b.uses999) ||
        topF(a) - topF(b) ||
        lowF(b) - lowF(a)
    );
  }

  // Too much metal/gold in the "whole lot" rows: every lot is either taken whole, cut (exactly one)
  // or left out, and the rest is ligature. Options that leave out the fewest lots win.
  //   y = (G' - R'*L/1000) / ((f_k - L)/1000), where R', G' = mass and gold left after the whole lots
  const CUT_SEARCH_MAX_LOTS = 10;

  function cutOptions(massMg, target, mandatory, ligatureFineness) {
    const L = ligatureFineness;
    const n = mandatory.length;
    if (n === 0 || n > CUT_SEARCH_MAX_LOTS) return [];
    const found = [];
    mandatory.forEach((cut, k) => {
      const others = mandatory.filter((_, i) => i !== k);
      for (let mask = 0; mask < 1 << others.length; mask++) {
        const whole = others.filter((_, i) => mask & (1 << i));
        const skipped = others.filter((_, i) => !(mask & (1 << i)));
        const restMg = massMg - sumMg(whole);
        const restGold = (massMg * target) / 1000 - goldOf(whole);
        if (restMg <= 0 || cut.fineness <= L) continue;
        const exact = (restGold * 1000 - restMg * L) / (cut.fineness - L);
        if (!(exact > 0) || exact > cut.mg) continue;
        const y = Math.min(round10(exact), cut.mg);
        const ligMg = restMg - y;
        if (y <= 0 || ligMg < 0) continue;
        const parts = mandatoryParts(whole);
        parts.push({ fineness: cut.fineness, mg: y, source: 'lot', wholeLot: false, cutFromMg: cut.mg, lotIds: [cut.id] });
        if (ligMg > 0) parts.push({ fineness: L, mg: ligMg, source: 'ligature', wholeLot: false, lotIds: [] });
        found.push({
          parts,
          ligMg,
          skipped: skipped.map((l) => ({ fineness: l.fineness, mg: l.mg, lotIds: [l.id] })),
          check: checkLine(parts, target),
          text: recipeText(parts),
        });
      }
    });
    if (!found.length) return [];
    const minSkipped = Math.min(...found.map((o) => o.skipped.length));
    const seen = new Set();
    return found
      .filter((o) => o.skipped.length === minSkipped)
      .sort((a, b) => a.ligMg - b.ligMg)
      .filter((o) => {
        // lots with equal mass and fineness give identical recipes
        const key = o.text + '|' + o.skipped.map((l) => l.mg + '@' + l.fineness).sort().join(',');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  // Fallback when no single lot can be cut: take x of the whole blend, x = M*(T-L)/(F_on-L),
  // split between lots by mass. Offered only when the blend is richer than the target (or equal).
  function blendDilution(massMg, target, mandatory, ligatureFineness) {
    const L = ligatureFineness;
    const totalOn = sumMg(mandatory);
    if (totalOn <= 0 || target <= L) return null;
    const fOn = blendFineness(mandatory);
    let x;
    if (sameFineness(fOn, target)) x = massMg;
    else if (fOn > target) x = round10((massMg * (target - L)) / (fOn - L));
    else return null;
    x = Math.min(x, totalOn, massMg);
    if (x <= 0) return null;

    const parts = [];
    let used = 0;
    mandatory.forEach((l, i) => {
      const share = i === mandatory.length - 1 ? x - used : Math.min(l.mg, round10((x * l.mg) / totalOn));
      used += share;
      if (share > 0) parts.push({ fineness: l.fineness, mg: share, source: 'lot', wholeLot: false, cutFromMg: l.mg, lotIds: [l.id] });
    });
    const ligMg = massMg - x;
    if (ligMg > 0) parts.push({ fineness: L, mg: ligMg, source: 'ligature', wholeLot: false, lotIds: [] });
    return { parts, check: checkLine(parts, target), text: recipeText(parts) };
  }

  // all dilution suggestions, best first
  function dilutionOptions(massMg, target, mandatory, ligatureFineness) {
    const cuts = cutOptions(massMg, target, mandatory, ligatureFineness);
    if (cuts.length) return cuts;
    const blend = blendDilution(massMg, target, mandatory, ligatureFineness);
    return blend ? [blend] : [];
  }

  function dilution(massMg, target, mandatory, ligatureFineness) {
    return dilutionOptions(massMg, target, mandatory, ligatureFineness)[0] || null;
  }

  // ---------- screen 1 ----------

  // input: { massMg, target, lots: [{ id, mg, fineness, mandatory }], ligatureFineness }
  function solve(input) {
    const massMg = input && input.massMg;
    const target = input && input.target;
    const L = (input && Number.isFinite(input.ligatureFineness)) ? input.ligatureFineness : 0;
    if (!Number.isInteger(massMg) || massMg <= 0) return { status: 'empty' };
    if (!Number.isFinite(target) || target < MIN_FINENESS || target > MAX_FINENESS) return { status: 'empty' };

    const lots = validLots(input.lots);
    const hasStock = lots.length > 0;
    const { mandatory, available } = splitMandatory(lots);
    const onMg = sumMg(mandatory);
    const fOn = blendFineness(mandatory);
    const rem = remainder(massMg, target, mandatory);
    const fmtOn = formatGrams(onMg) + ' г пробы ' + formatFineness(fOn);

    const fail = (code, message) => {
      const dilutions = dilutionOptions(massMg, target, mandatory, L);
      return { status: 'error', code, message, dilution: dilutions[0] || null, dilutions };
    };

    if (onMg > massMg) {
      return fail(
        'MANDATORY_EXCEEDS_MASS',
        'Отмечено «Весь в плавку» ' + fmtOn + ' — это больше, чем нужно залить (' + formatGrams(massMg) + ' г).'
      );
    }
    if (onMg === massMg) {
      const parts = mandatoryParts(mandatory);
      if (sameFineness(fOn, target)) {
        return {
          status: 'exact',
          message: 'Добавлять ничего не нужно: лоты «Весь в плавку» дают ровно ' + formatGrams(massMg) +
            ' г пробы ' + formatFineness(fOn) + '.',
          parts,
          check: checkLine(parts, target),
          text: recipeText(parts),
        };
      }
      return fail(
        'EXACT_MASS_WRONG_FINENESS',
        'Лоты «Весь в плавку» дают ровно ' + formatGrams(massMg) + ' г, но проба ' + formatFineness(fOn) +
          ' вместо ' + formatFinenessShort(target) + '.' +
          (fOn < target ? ' Нужен металл пробы выше ' + formatFinenessShort(target) + '.' : '')
      );
    }
    if (rem.goldMg < 0 || rem.fineness < L - TOL) {
      return fail(
        'TOO_MUCH_GOLD',
        'В лотах «Весь в плавку» (' + fmtOn + ') слишком много золота: даже с одной лигатурой проба будет выше ' +
          formatFinenessShort(target) + '.'
      );
    }
    if (rem.fineness > MAX_FINENESS + TOL) {
      return fail(
        'FINENESS_UNREACHABLE',
        'Лоты «Весь в плавку» слишком низкой пробы: остаток ' + formatGrams(rem.mg) + ' г должен быть пробы ' +
          formatFineness(rem.fineness) + ', а это выше 999. Уберите часть лотов из плавки.'
      );
    }

    const pool = buildPool(available, L, hasStock);
    const options = enumerateOptions(rem, pool, mandatory, target).map((o) => {
      o.section = !hasStock ? 'all' : o.reference ? 'other' : o.feasible ? 'stock' : 'short';
      return o;
    });
    return {
      status: 'ok',
      hasStock,
      hasMandatory: mandatory.length > 0,
      hasFreeStock: available.length > 0, // lots the solver may take partially (toggle OFF)
      remainder: { mg: rem.mg, fineness: rem.fineness },
      options: sortOptions(options),
    };
  }

  // header above the result cards: they describe what to melt, not the target
  function resultsTitle(massMg, target) {
    return 'Что взять для плавки (на ' + formatGramsShort(massMg) + ' г, проба ' + formatFinenessShort(target) + ')';
  }

  // ---------- screen 2 ----------

  // { rows: [{ mg, fineness }], ligatureMg, ligatureFineness } -> { totalMg, goldMg, fineness } | null
  function mixResult(input) {
    const L = Number.isFinite(input.ligatureFineness) ? input.ligatureFineness : 0;
    const parts = validLots(input.rows);
    if (Number.isInteger(input.ligatureMg) && input.ligatureMg > 0) parts.push({ mg: input.ligatureMg, fineness: L });
    const totalMg = sumMg(parts);
    if (totalMg <= 0) return null;
    const goldMg = goldOf(parts);
    return { totalMg, goldMg, fineness: (goldMg / totalMg) * 1000 };
  }

  // ---------- screen "Довести пробу" ----------

  // Have some metal (one or more rows of any fineness), want fineness T. The final mass is free:
  // add Y of another fineness, Y = m*(T - f)/(f_add - T), total = m + Y.
  // Below the target: add richer gold (750, 999, custom). Above it: ligature or 585 (or custom).
  const RAISE_WITH = [750, 999];
  const LOWER_WITH = [585];

  // input: { rows: [{ mg, fineness }], target, customFineness, ligatureFineness }
  function adjustFineness(input) {
    const target = input && input.target;
    const L = input && Number.isFinite(input.ligatureFineness) ? input.ligatureFineness : 0;
    if (!Number.isFinite(target) || target < MIN_FINENESS || target > MAX_FINENESS) return { status: 'empty' };
    const have = validLots(input.rows);
    const haveMg = sumMg(have);
    if (haveMg <= 0) return { status: 'empty' };
    const haveGoldMg = goldOf(have);
    const f = (haveGoldMg / haveMg) * 1000;
    const base = { haveMg, haveGoldMg, haveFineness: f };
    if (sameFineness(f, target)) {
      return Object.assign({ status: 'exact', message: 'Добавлять ничего не нужно: проба уже ' + formatFineness(f) + '.' }, base);
    }

    const up = f < target;
    const fits = (a) => (up ? a - target > TOL : target - a > TOL);
    const candidates = up
      ? RAISE_WITH.filter(fits).map((a) => ({ fineness: a, source: 'reference' }))
      : [{ fineness: L, source: 'ligature' }].filter((c) => fits(c.fineness))
          .concat(LOWER_WITH.filter(fits).map((a) => ({ fineness: a, source: 'reference' })));

    let customError = null;
    const custom = input.customFineness;
    if (Number.isFinite(custom)) {
      if (!fits(custom)) {
        customError = up ? 'Добавка должна быть выше ' + formatFinenessShort(target)
          : 'Добавка должна быть ниже ' + formatFinenessShort(target);
      } else if (!candidates.some((c) => sameFineness(c.fineness, custom))) {
        candidates.push({ fineness: custom, source: 'custom' });
      }
    }

    const options = [];
    for (const c of candidates) {
      const exact = (haveMg * (target - f)) / (c.fineness - target);
      const make = (mg) => ({ fineness: c.fineness, mg, source: c.source === 'ligature' ? 'ligature' : 'lot', wholeLot: false, lotIds: [] });
      // 0.01 g by default; small pieces fall back to 0.001 g when 0.01 g would miss the target
      let add = make(round10(exact));
      let check = checkLine(have.concat([add]), target);
      if (!check.ok || add.mg <= 0) {
        add = make(Math.round(exact));
        check = checkLine(have.concat([add]), target);
      }
      if (add.mg <= 0) continue;
      const addMg = add.mg;
      const totalMg = haveMg + addMg;
      options.push({
        parts: [add],
        source: c.source,
        addMg,
        totalMg,
        check,
        text: 'Добавить ' + partText(add) + ' → получится ' + formatGrams(totalMg) + ' г пробы ' + formatFinenessShort(target),
      });
    }
    return Object.assign({ status: 'ok', direction: up ? 'up' : 'down', options, customError }, base);
  }

  // ---------- history ----------

  // entry: { key, ... }; an existing entry with the same key moves to the top
  function addToHistory(list, entry, max) {
    const rest = (list || []).filter((e) => e.key !== entry.key);
    return [entry].concat(rest).slice(0, max || HISTORY_MAX);
  }

  return {
    TOL,
    REFERENCE_FINENESS,
    parseNumber,
    parseGrams,
    parseFineness,
    parseLigatureFineness,
    gramsToMg,
    round10,
    formatGrams,
    formatGramsShort,
    formatGold,
    formatFineness,
    formatFinenessShort,
    validLots,
    splitMandatory,
    remainder,
    buildPool,
    splitPair,
    checkLine,
    recipeText,
    enumerateOptions,
    sortOptions,
    cutOptions,
    dilutionOptions,
    dilution,
    solve,
    resultsTitle,
    mixResult,
    adjustFineness,
    addToHistory,
  };
});
