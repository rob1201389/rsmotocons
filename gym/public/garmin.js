/* Garmin / wearable file import. Everything happens on this device: the file is
   read in the browser, normalised, and stored in state.wellness. Nothing is sent
   anywhere, and nothing here talks to a Garmin service.

   Supported: Garmin Connect CSV exports (activities and sleep), TCX activity
   files, and the JSON sleep files in a Garmin data export. FIT is a binary
   format that is NOT supported; a FIT file is recognised and refused with a
   clear message instead of being guessed at.

   Staleness: data is only ever described by the dates it covers. Sleep from
   three or more days ago is never shown as today's readiness. */
const Garmin = (function () {
  'use strict';
  const STALE_DAYS = 3;
  const pad = n => String(n).padStart(2, '0');
  const isoDay = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return d ? `${d[3]}-${pad(d[2])}-${pad(d[1])}` : null; };       // d/m/yyyy, the Australian order
  function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

  /* ------------------------------------------------------------ csv */
  function csvRows(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some(x => x !== '')) rows.push(row);
    return rows;
  }
  const norm = h => String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function toMinutes(v) {
    v = String(v == null ? '' : v).trim(); if (!v || v === '--') return null;
    let m = v.match(/^(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/); if (m) return Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) / 60);
    m = v.match(/^(\d+):(\d{2})$/); if (m) return +m[1] * 60 + +m[2];                               // sleep totals are hh:mm
    m = v.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|m))?$/i); if (m && (m[1] || m[2])) return (+m[1] || 0) * 60 + (+m[2] || 0);
    const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null;
  }
  const num = v => { const n = Number(String(v == null ? '' : v).replace(/,/g, '').trim()); return String(v).trim() === '' || String(v).trim() === '--' || !Number.isFinite(n) ? null : n; };

  const TYPE = [
    [/strength|weight|gym|resistance/i, 'strength', 'moderate'], [/hiit|interval|crossfit|boot/i, 'hiit', 'hard'],
    [/run|jog|treadmill/i, 'run', 'moderate'], [/cycl|bik|spin|ride/i, 'cycle', 'moderate'], [/swim/i, 'swim', 'moderate'],
    [/row/i, 'row', 'moderate'], [/walk|hik/i, 'walk', 'easy'], [/yoga|pilates|stretch|mobility|breath/i, 'mobility', 'easy'],
    [/elliptical|cardio|stair|aerobic/i, 'cardio', 'moderate']
  ];
  function classify(label) { for (const [re, kind, intensity] of TYPE) if (re.test(label || '')) return { kind, intensity }; return { kind: 'other', intensity: 'moderate' }; }

  function parseCsv(text) {
    const rows = csvRows(text); if (rows.length < 2) return { kind: 'unknown', rows: [], problems: ['The file has no data rows.'] };
    const head = rows[0].map(norm), at = (...names) => { for (const n of names) { const i = head.findIndex(h => h === n || h.startsWith(n)); if (i >= 0) return i; } return -1; };
    const iType = at('activity type', 'type'), iDate = at('date', 'sleep date', 'calendar date', 'start time'), iTime = at('time', 'elapsed time', 'duration', 'moving time');
    const iDur = at('duration', 'total sleep', 'sleep duration', 'time asleep', 'sleep time'), iScore = at('score', 'sleep score', 'overall score');
    const looksSleep = head.some(h => /sleep/.test(h)) && iDur >= 0 && iType < 0;
    const out = [], problems = []; let skipped = 0;
    if (looksSleep || (iType < 0 && iDate >= 0 && iDur >= 0)) {
      rows.slice(1).forEach(r => {
        const date = isoDay(r[iDate]), mins = toMinutes(r[iDur]);
        if (!date || mins == null || mins <= 0 || mins > 18 * 60) { skipped++; return; }
        out.push({ date, hours: Math.round(mins / 6) / 10, score: iScore >= 0 ? num(r[iScore]) : null, source: 'csv' });
      });
      return { kind: 'sleep', rows: out, skipped, problems: out.length ? problems : ['No sleep rows could be read. Expected a date and a duration column.'] };
    }
    if (iType >= 0 && iDate >= 0) {
      const iTitle = at('title'), iDist = at('distance'), iCal = at('calories'), iHr = at('avg hr', 'average heart rate'), iMax = at('max hr');
      rows.slice(1).forEach(r => {
        const date = isoDay(r[iDate]), mins = toMinutes(r[iTime >= 0 ? iTime : iDur]);
        if (!date || !mins || mins <= 0 || mins > 24 * 60) { skipped++; return; }
        const c = classify((r[iType] || '') + ' ' + (iTitle >= 0 ? r[iTitle] : ''));
        out.push({ date, type: r[iType] || 'Activity', kind: c.kind, intensity: c.intensity, minutes: mins, distanceKm: iDist >= 0 ? num(r[iDist]) : null,
          calories: iCal >= 0 ? num(r[iCal]) : null, avgHr: iHr >= 0 ? num(r[iHr]) : null, maxHr: iMax >= 0 ? num(r[iMax]) : null, source: 'csv' });
      });
      return { kind: 'activity', rows: out, skipped, problems: out.length ? problems : ['No activity rows could be read.'] };
    }
    return { kind: 'unknown', rows: [], problems: ['This CSV does not look like a Garmin Connect activities or sleep export. Expected columns such as Activity Type and Date, or Date and Sleep duration.'] };
  }

  /* ------------------------------------------------------------ json */
  function parseJson(text) {
    let data; try { data = JSON.parse(text); } catch (e) { return { kind: 'unknown', rows: [], problems: ['The file is not valid JSON.'] }; }
    const arr = Array.isArray(data) ? data : (data && Array.isArray(data.sleep) ? data.sleep : null);
    if (!arr) return { kind: 'unknown', rows: [], problems: ['This JSON is not a Garmin sleep export (expected a list of nights).'] };
    const out = []; let skipped = 0;
    arr.forEach(n => {
      const date = isoDay(n.calendarDate || n.sleepEndTimestampGMT || n.sleepStartTimestampGMT);
      const secs = ['deepSleepSeconds', 'lightSleepSeconds', 'remSleepSeconds'].reduce((a, k) => a + (Number(n[k]) || 0), 0);
      if (!date || secs <= 0 || secs > 18 * 3600) { skipped++; return; }
      const sc = n.overallScore && typeof n.overallScore === 'object' ? n.overallScore.value : n.overallScore;
      out.push({ date, hours: Math.round(secs / 360) / 10, score: Number.isFinite(Number(sc)) ? Number(sc) : null, source: 'json' });
    });
    return { kind: 'sleep', rows: out, skipped, problems: out.length ? [] : ['No nights with sleep time were found.'] };
  }

  /* ------------------------------------------------------------ tcx */
  function parseTcx(text) {
    const out = []; const acts = String(text).match(/<Activity\b[\s\S]*?<\/Activity>/g) || [];
    acts.forEach(a => {
      const sport = (a.match(/Sport="([^"]*)"/) || [])[1] || 'Activity';
      const id = (a.match(/<Id>([^<]*)<\/Id>/) || [])[1] || (a.match(/StartTime="([^"]*)"/) || [])[1];
      const secs = (a.match(/<TotalTimeSeconds>([\d.]+)<\/TotalTimeSeconds>/g) || []).reduce((s, x) => s + Number(x.replace(/<[^>]*>/g, '')), 0);
      const dist = (a.match(/<DistanceMeters>([\d.]+)<\/DistanceMeters>/g) || []).reduce((s, x) => s + Number(x.replace(/<[^>]*>/g, '')), 0);
      const cal = (a.match(/<Calories>(\d+)<\/Calories>/g) || []).reduce((s, x) => s + Number(x.replace(/<[^>]*>/g, '')), 0);
      const hr = (a.match(/<AverageHeartRateBpm[^>]*>\s*<Value>(\d+)<\/Value>/) || [])[1];
      const date = isoDay(id); if (!date || secs <= 0) return;
      const c = classify(sport);
      out.push({ date, type: sport, kind: c.kind, intensity: c.intensity, minutes: Math.round(secs / 60), distanceKm: dist ? Math.round(dist / 100) / 10 : null, calories: cal || null, avgHr: hr ? Number(hr) : null, maxHr: null, source: 'tcx' });
    });
    return { kind: 'activity', rows: out, skipped: 0, problems: out.length ? [] : ['No activities with a duration were found in this TCX file.'] };
  }

  /* --------------------------------------------------------- detection */
  function parse(content, filename) {
    const name = String(filename || '').toLowerCase();
    if (content instanceof ArrayBuffer || (typeof Uint8Array !== 'undefined' && content instanceof Uint8Array)) {
      const b = new Uint8Array(content);
      if (name.endsWith('.fit') || (b.length > 12 && String.fromCharCode(b[8], b[9], b[10], b[11]) === '.FIT'))
        return { kind: 'unsupported', format: 'fit', rows: [], problems: ['FIT files are not supported. Export the activity as TCX or CSV from Garmin Connect, or use the Garmin data export for sleep (JSON).'] };
      content = new TextDecoder('utf-8').decode(b);
    }
    const text = String(content || '').replace(/^﻿/, '');
    if (!text.trim()) return { kind: 'unknown', rows: [], problems: ['The file is empty.'] };
    let res;
    if (/^\s*[\[{]/.test(text)) res = parseJson(text);
    else if (/^\s*<\?xml|<TrainingCenterDatabase/i.test(text)) res = parseTcx(text);
    else res = parseCsv(text);
    res.filename = filename || null; res.format = res.format || (/^\s*[\[{]/.test(text) ? 'json' : /^\s*<\?xml|<TrainingCenterDatabase/i.test(text) ? 'tcx' : 'csv');
    const dates = res.rows.map(r => r.date).sort();
    res.coverage = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
    return res;
  }

  /* ----------------------------------------------------------- storing */
  function ensure(state) { state.wellness = Object.assign({ sleep: [], activities: [], imports: [] }, state.wellness || {}); return state.wellness; }
  /* Adds rows that are not already there. Re-importing the same file adds nothing. */
  function applyImport(state, parsed, nowMs) {
    if (!parsed || !parsed.rows || !parsed.rows.length) return { ok: false, added: 0, duplicates: 0 };
    const w = ensure(state); let added = 0, duplicates = 0;
    const importId = 'im_' + nowMs;
    /* Every stored row remembers which import brought it, so one import can be deleted on its own. */
    if (parsed.kind === 'sleep') parsed.rows.forEach(r => {
      const i = w.sleep.findIndex(x => x.date === r.date);
      if (i >= 0) { duplicates++; if (w.sleep[i].hours !== r.hours) { w.sleep[i] = Object.assign({}, r, { importId }); } } else { w.sleep.push(Object.assign({}, r, { importId })); added++; }
    });
    else parsed.rows.forEach(r => {
      if (w.activities.some(x => x.date === r.date && x.type === r.type && x.minutes === r.minutes)) { duplicates++; return; }
      w.activities.push(Object.assign({ id: 'ac_' + r.date + '_' + added + '_' + w.activities.length, excluded: r.kind === 'strength', linkedSessionId: null, importId }, r)); added++;
    });
    w.sleep.sort((a, b) => a.date < b.date ? -1 : 1); w.activities.sort((a, b) => a.date < b.date ? -1 : 1);
    w.imports.push({ id: importId, kind: parsed.kind, format: parsed.format, filename: parsed.filename, rows: parsed.rows.length, added, duplicates, coverage: parsed.coverage, importedAt: nowMs });
    return { ok: true, added, duplicates, coverage: parsed.coverage };
  }
  /* Deletes one import and every row it brought in. Rows imported before rows were
     tagged (no importId) can only be removed with clearAll. Returns rows removed. */
  function removeImport(state, importId) {
    const w = ensure(state); const im = w.imports.find(i => i.id === importId); if (!im) return null;
    const before = w.sleep.length + w.activities.length;
    w.sleep = w.sleep.filter(r => r.importId !== importId);
    w.activities = w.activities.filter(r => r.importId !== importId);
    w.imports = w.imports.filter(i => i.id !== importId);
    return { removed: before - (w.sleep.length + w.activities.length), untagged: w.sleep.concat(w.activities).filter(r => !r.importId).length };
  }
  function clearAll(state) { state.wellness = { sleep: [], activities: [], imports: [] }; }

  /* What can honestly be said today. Old data is never presented as current. */
  function current(state, todayISO) {
    const w = ensure(state);
    const dates = w.imports.map(i => i.coverage && i.coverage.to).filter(Boolean).sort();
    const coverageEnd = dates.length ? dates[dates.length - 1] : null;
    if (!w.imports.length) return { hasData: false, stale: true, coverageEnd: null, sleep: null, message: 'No wearable data has been imported. Readiness uses your own ratings.' };
    const age = dayDiff(coverageEnd, todayISO);
    const last = w.sleep.filter(s => s.date <= todayISO).slice(-1)[0] || null;
    const lastAge = last ? dayDiff(last.date, todayISO) : null;
    const stale = age > STALE_DAYS;
    const usableSleep = last && lastAge <= 1 ? last : null;                   // last night only
    return { hasData: true, stale, coverageEnd, ageDays: age, sleep: usableSleep, lastSleep: last,
      message: stale ? `Imported data ends on ${coverageEnd}, ${age} days ago. It is not used for today's readiness.`
        : usableSleep ? `Last night's sleep: ${usableSleep.hours} h (from the import covering to ${coverageEnd}).`
        : `Imported data covers to ${coverageEnd}. There is no sleep record for last night, so none is shown.` };
  }
  /* Recent activities and sleep for the Recovery screen, labelled with the coverage. */
  function summary(state, fromISO, toISO) {
    const w = ensure(state);
    const sleep = w.sleep.filter(s => s.date >= fromISO && s.date <= toISO);
    const acts = w.activities.filter(a => a.date >= fromISO && a.date <= toISO && !a.excluded);
    return { sleepNights: sleep.length, avgSleepHours: sleep.length ? Math.round(sleep.reduce((a, s) => a + s.hours, 0) / sleep.length * 10) / 10 : null,
      activities: acts.length, activityMinutes: acts.reduce((a, x) => a + x.minutes, 0), from: fromISO, to: toISO };
  }
  return { STALE_DAYS, parse, parseCsv, parseJson, parseTcx, classify, applyImport, removeImport, clearAll, current, summary, ensure };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Garmin;
