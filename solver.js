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

  // Whole-lot rows that do not fit as they are (too much metal, too rich or too poor): every lot is
  // taken whole, cut (exactly one) or left out, and the rest is ONE fill material from the pool
  // (ligature, a free stock lot or a reference fineness). Options that leave out the fewest lots win.
  //   mass: W + y + a = M,  gold: G_W + y*f_k + a*f_A = M*T  =>  y = (R'*f_A - G') / (f_A - f_k)
  //   where R', G' = mass and gold still needed after the whole lots
  const CUT_SEARCH_MAX_LOTS = 10;
  const FILL_RANK = { ligature: 0, stock: 1, reference: 2 };

  function cutOptions(massMg, target, mandatory, pool) {
    const n = mandatory.length;
    if (n === 0 || n > CUT_SEARCH_MAX_LOTS) return [];
    const goalGold = (massMg * target) / 1000;
    const found = [];
    mandatory.forEach((cut, k) => {
      const others = mandatory.filter((_, i) => i !== k);
      for (let mask = 0; mask < 1 << others.length; mask++) {
        const whole = others.filter((_, i) => mask & (1 << i));
        const skipped = others.filter((_, i) => !(mask & (1 << i)));
        const restMg = massMg - sumMg(whole);
        const restGold = goalGold - goldOf(whole);
        if (restMg <= 0) continue;
        for (const fill of pool) {
          if (sameFineness(fill.fineness, cut.fineness)) continue;
          const exact = ((restMg * fill.fineness) / 1000 - restGold) / ((fill.fineness - cut.fineness) / 1000);
          if (!(exact > 0) || exact > cut.mg) continue;
          const build = (y) => {
            const parts = mandatoryParts(whole);
            parts.push({ fineness: cut.fineness, mg: y, source: 'lot', wholeLot: false, cutFromMg: cut.mg, lotIds: [cut.id] });
            const fillMg = restMg - y;
            if (fillMg > 0) {
              parts.push({ fineness: fill.fineness, mg: fillMg, source: fill.source, wholeLot: false, limitMg: fill.limitMg, lotIds: fill.lotIds });
            }
            return { parts, fillMg, check: checkLine(parts, target) };
          };
          let opt = build(Math.min(round10(exact), cut.mg));
          if (!opt.check.ok) opt = build(Math.min(Math.round(exact), cut.mg));
          if (opt.parts.some((p) => p.mg <= 0) || opt.fillMg < 0) continue;
          const shortMg = opt.fillMg > fill.limitMg ? opt.fillMg - fill.limitMg : 0;
          found.push({
            parts: opt.parts,
            fill: opt.fillMg > 0 ? fill : null,
            fillMg: opt.fillMg,
            skipped: skipped.map((l) => ({ fineness: l.fineness, mg: l.mg, lotIds: [l.id] })),
            leftover: { fineness: cut.fineness, mg: cut.mg - opt.parts.find((p) => p.source === 'lot').mg, lotIds: [cut.id] },
            feasible: shortMg === 0,
            shortageMg: shortMg,
            note: shortMg ? 'не хватает ' + formatGrams(shortMg) + ' г (проба ' + formatFinenessShort(fill.fineness) + ')' : '',
            check: opt.check,
            text: recipeText(opt.parts),
          });
        }
      }
    });
    if (!found.length) return [];
    const minSkipped = Math.min(...found.map((o) => o.skipped.length));
    const rank = (o) => (o.fill ? FILL_RANK[o.fill.source] : -1);
    const seen = new Set();
    return found
      .filter((o) => o.skipped.length === minSkipped)
      .sort((a, b) => Number(b.feasible) - Number(a.feasible) || rank(a) - rank(b) || a.fillMg - b.fillMg)
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
  function dilutionOptions(massMg, target, mandatory, ligatureFineness, pool) {
    const fillPool = pool || [{ fineness: ligatureFineness, limitMg: Infinity, source: 'ligature', lotIds: [] }];
    const cuts = cutOptions(massMg, target, mandatory, fillPool);
    if (cuts.length) return cuts;
    const blend = blendDilution(massMg, target, mandatory, ligatureFineness);
    return blend ? [blend] : [];
  }

  function dilution(massMg, target, mandatory, ligatureFineness, pool) {
    return dilutionOptions(massMg, target, mandatory, ligatureFineness, pool)[0] || null;
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
    const pool = buildPool(available, L, hasStock);

    const fail = (code, message) => {
      const dilutions = dilutionOptions(massMg, target, mandatory, L, pool);
      return { status: 'error', code, message, dilution: dilutions[0] || null, dilutions };
    };

    if (onMg > massMg) {
      return fail(
        'MANDATORY_EXCEEDS_MASS',
        '«Взять целиком» отмечено для ' + fmtOn + ', а залить нужно только ' + formatGrams(massMg) + ' г.'
      );
    }
    if (onMg === massMg) {
      const parts = mandatoryParts(mandatory);
      if (sameFineness(fOn, target)) {
        return {
          status: 'exact',
          message: 'Добавлять ничего не нужно: куски «Взять целиком» дают ровно ' + formatGrams(massMg) +
            ' г пробы ' + formatFineness(fOn) + '.',
          parts,
          check: checkLine(parts, target),
          text: recipeText(parts),
        };
      }
      return fail(
        'EXACT_MASS_WRONG_FINENESS',
        'Куски «Взять целиком» дают ровно ' + formatGrams(massMg) + ' г, но проба ' + formatFineness(fOn) +
          ' вместо ' + formatFinenessShort(target) + '.'
      );
    }
    if (rem.goldMg < 0 || rem.fineness < L - TOL) {
      return fail(
        'TOO_MUCH_GOLD',
        'В кусках «Взять целиком» (' + fmtOn + ') слишком много золота: даже с одной лигатурой проба будет выше ' +
          formatFinenessShort(target) + '.'
      );
    }
    if (rem.fineness > MAX_FINENESS + TOL) {
      return fail(
        'FINENESS_UNREACHABLE',
        'Куски «Взять целиком» (' + fmtOn + ') слишком низкой пробы: целиком их не взять, даже добавив 999.'
      );
    }

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

  // Have some metal (one or more rows of any fineness), want fineness T; the final mass is free.
  // Additions come from stock (rows with grams = limits), ligature (lowering only, unlimited)
  // and reference finenesses (unlimited, "наличие не указано"). Per gram an addition of fineness f
  // moves the balance by |f - T|; the base needs m*|T - f_base| in total.
  const RAISE_WITH = [750, 999];
  const LOWER_WITH = [585];

  // input: { rows: [{ mg, fineness }], stock: [{ mg, fineness }], target, ligatureFineness }
  function adjustFineness(input) {
    const target = input && input.target;
    const L = input && Number.isFinite(input.ligatureFineness) ? input.ligatureFineness : 0;
    if (!Number.isFinite(target) || target < MIN_FINENESS || target > MAX_FINENESS) return { status: 'empty' };
    const base = validLots((input.rows || []).map((r, i) => Object.assign({ id: 'b' + i }, r)));
    const haveMg = sumMg(base);
    if (haveMg <= 0) return { status: 'empty' };
    const haveGoldMg = goldOf(base);
    const f0 = (haveGoldMg / haveMg) * 1000;
    const head = { haveMg, haveGoldMg, haveFineness: f0 };
    if (sameFineness(f0, target)) {
      return Object.assign({ status: 'exact', message: 'Добавлять ничего не нужно: проба уже ' + formatFineness(f0) + '.' }, head);
    }

    const up = f0 < target;
    const gain = (f) => (up ? f - target : target - f); // > 0: moves the blend toward the target
    const cost = (f) => -gain(f); // per gram of base metal
    const need = base.reduce((acc, r) => acc + r.mg * cost(r.fineness), 0); // > 0

    const stockLots = validLots((input.stock || []).map((r, i) => Object.assign({ id: 's' + i }, r)));
    const hasStock = stockLots.length > 0;
    const merged = buildPool(stockLots, L, true).filter((m) => m.source === 'stock');
    const own = merged.filter((m) => gain(m.fineness) > TOL);
    if (!up && gain(L) > TOL) own.push({ fineness: L, limitMg: Infinity, source: 'ligature', lotIds: [] });
    const refs = (up ? RAISE_WITH : LOWER_WITH)
      .filter((f) => gain(f) > TOL && !merged.some((m) => sameFineness(m.fineness, f)) && !sameFineness(f, L))
      .map((f) => ({ fineness: f, limitMg: Infinity, source: 'reference', lotIds: [] }));

    const basePart = (r, mg) => ({ fineness: r.fineness, mg, source: 'base', wholeLot: mg === r.mg && base.length > 1,
      cutFromMg: mg < r.mg ? r.mg : undefined, lotIds: [r.id] });
    const addPart = (m, mg) => ({ fineness: m.fineness, mg, source: m.source === 'ligature' ? 'ligature' : 'lot',
      wholeLot: false, limitMg: m.limitMg, ownMg: m.ownMg, from: m.source, lotIds: m.lotIds });

    // Greedy fill of `amount` with materials in the given order (limits respected). The last one
    // is rounded to 0.01 g, or to 0.001 g if 0.01 g misses the target. Null if not enough.
    const fillWith = (usedBase, amount, mats) => {
      const adds = [];
      let rest = amount;
      for (const m of mats) {
        if (rest <= 0) break;
        const capacity = m.limitMg * gain(m.fineness);
        if (capacity < rest) {
          adds.push({ m, mg: m.limitMg });
          rest -= capacity;
        } else {
          adds.push({ m, exact: rest / gain(m.fineness) });
          rest = 0;
        }
      }
      if (rest > 0) return null;
      const make = (round) => adds.map((a) => addPart(a.m, a.mg !== undefined ? a.mg : Math.min(round(a.exact), a.m.limitMg)));
      let parts = make(round10);
      if (!checkLine(usedBase.concat(parts), target).ok || parts.some((p) => p.mg <= 0)) parts = make(Math.round);
      return parts.some((p) => p.mg <= 0) ? null : parts;
    };

    const fullBase = base.map((r) => basePart(r, r.mg));
    const options = [];
    const seen = new Set();
    const push = (kind, section, usedBase, addsIn, aside, note) => {
      const adds = addsIn.slice().sort((a, b) => (a.source === 'ligature') - (b.source === 'ligature') || b.fineness - a.fineness);
      const all = usedBase.concat(adds);
      const totalMg = sumMg(all);
      const T = formatFinenessShort(target);
      const text = aside.length
        ? 'Взять ' + usedBase.map(partText).join(' + ') + ', добавить ' + adds.map(partText).join(' + ') +
          ' → получится ' + formatGrams(totalMg) + ' г пробы ' + T +
          '; отложить ' + aside.map((a) => formatGrams(a.mg) + ' г ' + formatFinenessShort(a.fineness)).join(', ')
        : 'Добавить ' + adds.map(partText).join(' + ') + ' → получится ' + formatGrams(totalMg) + ' г пробы ' + T;
      if (seen.has(text)) return;
      seen.add(text);
      options.push({
        kind,
        section: hasStock ? section : 'all',
        parts: (base.length > 1 || aside.length ? usedBase : []).concat(adds),
        base: usedBase,
        adds,
        aside,
        addMg: sumMg(adds),
        totalMg,
        note: note || '',
        check: checkLine(all, target),
        text,
      });
    };

    // own stock: each material alone, then mixes (richest first = least metal, poorest first)
    for (const m of own) {
      const adds = fillWith(fullBase, need, [m]);
      if (adds) push('single', 'stock', fullBase, adds, []);
    }
    if (own.length > 1) {
      const byGain = own.slice().sort((a, b) => gain(b.fineness) - gain(a.fineness));
      for (const order of [byGain, byGain.slice().reverse()]) {
        const adds = fillWith(fullBase, need, order);
        if (adds) push('mix', 'stock', fullBase, adds, []);
      }
    }

    // not enough stock: raise only part of the base (rows that need least first), set the rest aside,
    // or use all own stock and top up with a reference fineness
    const capacity = own.reduce((acc, m) => acc + m.limitMg * gain(m.fineness), 0);
    if (own.length && capacity < need) {
      const fullOwn = own.map((m) => addPart(m, m.limitMg));
      const order = base.slice().sort((a, b) => cost(a.fineness) - cost(b.fineness));
      const build = (round) => {
        let budget = capacity;
        const used = [];
        const aside = [];
        for (const r of order) {
          const c = cost(r.fineness);
          if (c <= 0 || r.mg * c <= budget) {
            used.push(basePart(r, r.mg));
            budget -= r.mg * c;
            continue;
          }
          const x = Math.min(round(budget / c), r.mg);
          budget = 0;
          if (x > 0) used.push(basePart(r, x));
          if (r.mg - x > 0) aside.push({ fineness: r.fineness, mg: r.mg - x, lotIds: [r.id] });
        }
        return { used, aside };
      };
      let partial = build(round10);
      if (!checkLine(partial.used.concat(fullOwn), target).ok) partial = build(Math.round);
      if (partial.used.length && partial.aside.length) push('partial', 'stock', partial.used, fullOwn, partial.aside);

      // all own stock + buy the rest of one fineness (also more of a fineness that is in stock)
      for (const f of up ? RAISE_WITH : LOWER_WITH) {
        if (gain(f) <= TOL || sameFineness(f, L)) continue;
        const inStock = own.find((m) => sameFineness(m.fineness, f));
        const limited = own.filter((m) => m !== inStock);
        const extra = inStock
          ? Object.assign({}, inStock, { limitMg: Infinity, ownMg: inStock.limitMg })
          : { fineness: f, limitMg: Infinity, ownMg: 0, source: 'reference', lotIds: [] };
        const adds = fillWith(fullBase, need, limited.concat([extra]));
        if (!adds) continue;
        const bought = adds.find((a) => a.ownMg !== undefined);
        const buyMg = bought ? bought.mg - bought.ownMg : 0;
        if (buyMg <= 0) continue;
        push('topup', 'other', fullBase, adds, [], 'докупить ' + formatGrams(buyMg) + ' г ' + formatFinenessShort(f));
      }
    }

    // reference finenesses alone
    for (const ref of refs) {
      const adds = fillWith(fullBase, need, [ref]);
      if (adds) push('single', 'other', fullBase, adds, [], hasStock ? 'докупить ' + formatGrams(adds[0].mg) + ' г ' + formatFinenessShort(ref.fineness) : '');
    }

    return Object.assign({ status: 'ok', direction: up ? 'up' : 'down', hasStock, options }, head);
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
