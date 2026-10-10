/* Wearable import tests. Run: node gym/test/garmin.test.js */
const path = require('path'), fs = require('fs');
const dir = fs.existsSync(path.join(__dirname, '../public/garmin.js')) ? '../public/' : './';
const G = require(dir + 'garmin.js'), C = require(dir + 'core.js'), K = require('./simkit.js');
const { t, eq, ok, sec, done } = K.counters();

const ACT = 'Activity Type,Date,Favorite,Title,Distance,Calories,Time,Avg HR,Max HR\nRunning,2026-09-08 06:10:00,false,Morning run,5.20,412,00:31:05,152,171\nStrength Training,2026-09-09 17:00:00,false,Gym,0.00,230,00:55:00,110,140\nWalking,2026-09-10 12:00:00,false,Lunch walk,2.1,90,00:25:00,98,110\nCycling,bad date,false,x,1,1,00:10:00,1,1\n';
const SLEEP = 'Date,Sleep Score,Duration\n2026-09-08,81,7:12\n2026-09-09,64,5h 30min\n2026-09-10,--,0:00\n';
const GDPR = JSON.stringify([{ calendarDate: '2026-09-09', deepSleepSeconds: 5400, lightSleepSeconds: 14400, remSleepSeconds: 5400, awakeSleepSeconds: 900, overallScore: { value: 77 } }, { calendarDate: '2026-09-10', deepSleepSeconds: 0, lightSleepSeconds: 0, remSleepSeconds: 0 }]);
const TCX = '<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>2026-09-11T07:00:00Z</Id><Lap StartTime="2026-09-11T07:00:00Z"><TotalTimeSeconds>2700</TotalTimeSeconds><DistanceMeters>21000</DistanceMeters><Calories>500</Calories><AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm></Lap></Activity></Activities></TrainingCenterDatabase>';

sec('PARSING');
t('Garmin Connect activities CSV: rows, minutes, kind, and the bad row is skipped', () => { const p = G.parse(ACT, 'Activities.csv'); eq(p.kind, 'activity'); eq(p.rows.length, 3); eq(p.skipped, 1); eq(p.rows[0].minutes, 31); eq(p.rows[0].kind, 'run'); eq(p.coverage, { from: '2026-09-08', to: '2026-09-10' }); });
t('sleep CSV: hh:mm and 5h 30min both read, zero-length nights skipped', () => { const p = G.parse(SLEEP, 's.csv'); eq(p.kind, 'sleep'); eq(p.rows.map(r => r.hours), [7.2, 5.5]); eq(p.rows[0].score, 81); });
t('Garmin export sleep JSON', () => { const p = G.parse(GDPR, 'sleepData.json'); eq(p.kind, 'sleep'); eq(p.rows.length, 1); eq(p.rows[0].hours, 7); eq(p.rows[0].score, 77); });
t('TCX activity', () => { const p = G.parse(TCX, 'a.tcx'); eq(p.kind, 'activity'); eq(p.rows[0].minutes, 45); eq(p.rows[0].distanceKm, 21); eq(p.rows[0].kind, 'cycle'); });
t('FIT is recognised and refused, not guessed at', () => { const b = new Uint8Array(20); [0x2e, 0x46, 0x49, 0x54].forEach((c, i) => { b[8 + i] = c; }); const p = G.parse(b.buffer, 'x.fit'); eq(p.kind, 'unsupported'); ok(/not supported/.test(p.problems[0])); });
t('unrelated files give a plain reason', () => { ok(G.parse('a,b\n1,2', 'x.csv').problems[0].includes('does not look like')); ok(G.parse('{bad', 'x.json').problems.length); ok(G.parse('', 'x').problems[0].includes('empty')); });
t('Australian d/m/yyyy dates read in the right order', () => { const p = G.parse('Date,Duration\n03/09/2026,7:00\n', 's.csv'); eq(p.rows[0].date, '2026-09-03'); });

sec('STORING');
t('import adds rows, strength sessions default to excluded so they are not double counted', () => {
  const s = C.blankState(); const r = G.applyImport(s, G.parse(ACT, 'a.csv'), 1);
  eq(r.added, 3); eq(s.wellness.activities.find(a => a.kind === 'strength').excluded, true); eq(s.wellness.activities.find(a => a.kind === 'run').excluded, false);
});
t('re-importing the same file adds nothing', () => { const s = C.blankState(); G.applyImport(s, G.parse(ACT, 'a.csv'), 1); const r = G.applyImport(s, G.parse(ACT, 'a.csv'), 2); eq(r.added, 0); eq(r.duplicates, 3); eq(s.wellness.activities.length, 3); });
t('imported cardio counts toward the week\'s conditioning load', () => {
  const s = K.newUser(); G.applyImport(s, G.parse(ACT, 'a.csv'), 1); const w = K.weekAt(s, K.MON);
  ok(K.P.weekLoad(s, w).externalMinutes >= 56);
});

sec('STALENESS');
t('no import: says so, readiness uses own ratings', () => { const c = G.current(C.blankState(), '2026-09-10'); eq(c.hasData, false); ok(/own ratings/.test(c.message)); });
t('fresh import: last night\'s sleep is shown with its coverage', () => { const s = C.blankState(); G.applyImport(s, G.parse(SLEEP, 's.csv'), 1); const c = G.current(s, '2026-09-09'); eq(c.stale, false); eq(c.sleep.hours, 5.5); ok(/2026-09-09/.test(c.message)); });
t('old data is never presented as today\'s readiness', () => { const s = C.blankState(); G.applyImport(s, G.parse(SLEEP, 's.csv'), 1); const c = G.current(s, '2026-09-20'); eq(c.stale, true); eq(c.sleep, null); ok(/not used for today/.test(c.message)); });
t('a gap of a day or two shows no sleep rather than the old night', () => { const s = C.blankState(); G.applyImport(s, G.parse(SLEEP, 's.csv'), 1); const c = G.current(s, '2026-09-12'); eq(c.sleep, null); ok(/no sleep record for last night/.test(c.message)); });
done();
