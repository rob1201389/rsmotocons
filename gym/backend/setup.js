#!/usr/bin/env node
/* One-time owner setup.

   Generates a strong passphrase locally, creates the owner account, and prints
   the passphrase ONCE to this terminal. It is never written to a file, never
   logged, never committed, and never transmitted anywhere.

   Usage:
     node backend/setup.js you@yourdomain
     node backend/setup.js you@yourdomain --words 6
     node backend/setup.js you@yourdomain --show-only     # generate, create nothing
*/
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { nodeDb } from './src/db.js';
import { bootstrapOwner } from './src/auth.js';
import { passwordProblems } from './src/crypto.js';

/* A small, deliberately plain wordlist. Short, unambiguous, easy to type on a
   phone keyboard. Words are chosen with crypto randomness, not Math.random. */
const WORDS = ('anchor amber anvil apron arbor arrow aspen atlas bacon badge bagel baker balsa'
+' banjo barge basil baton beach beacon beetle bellow birch bison blaze blend bloom board bolt'
+' bonus booth boulder brass brick bridge brisk bronze brook brush buckle bugle bundle burrow'
+' cabin cable cactus camel candle canvas canyon cargo carpet castle cedar chalk charm cherry'
+' chisel cinder citrus clamp clever cliff clover cobalt cocoa comet copper coral cotton cove'
+' cradle crane crater crayon creek crest cricket crisp crown crumb crystal cupboard current'
+' cymbal dagger dahlia daisy dapper dart dawn decoy denim desert diner ditch dollar domino'
+' donkey dragon drift drummer dusty eagle ember emerald engine escape ether fabric falcon'
+' fathom feather fennel ferry fiddle filter finch flagon flannel flint floral flume forest'
+' fossil fountain fox frame frost gadget gallon garden garnet gavel gentle geyser ginger'
+' glacier glider granite gravel grotto guitar gully gusto hammer harbor harvest hazel heather'
+' hickory hollow honey hornet hunter igloo indigo ivory jacket jasper jetty jigsaw jungle'
+' kettle keyhole kindle kitten koala ladder lagoon lantern lattice lavender ledger lemon'
+' lentil lichen lilac linen lobster locket lotus lumber lunar magnet mallet mango maple'
+' marble marina marsh meadow medal melon meteor mimosa mineral mint mirror mitten modem'
+' monsoon mosaic moss motor mulberry mustard nectar needle nestle nickel noble nomad nougat'
+' nozzle nugget oasis oatmeal ocean ochre olive onyx opal orbit orchard organ osprey otter'
+' oyster paddle palace pantry paprika parcel parsnip pastel patio pebble pelican pepper'
+' petal pewter phantom pigment pillar pilot pinecone pistol pivot plank plaza plume pocket'
+' pollen poppy portal possum pottery prairie pretzel prism puffin pumpkin purple quarry'
+' quartz quill quiver radish rafter rattan raven ribbon ridge rivet robin rocket roster'
+' rubble rudder saddle saffron sailor salmon sandal sapphire satchel scarlet scooter sculpt'
+' seagull sequin shadow shale shelter sherbet shingle shovel shutter sierra signal silk'
+' silver siphon skiff slate sleigh slipper smoky socket solar sonnet sparrow spindle spiral'
+' spruce squash stable stencil stirrup stone stormy stucco sugar summit sunset supper swivel'
+' sycamore tabby tackle talon tandem tangle tapioca tavern teapot tempo tendril thimble'
+' thistle thunder timber tinsel toffee topaz torch tortoise totem tractor trellis tribute'
+' trinket trolley trophy trowel truffle trumpet tulip tundra turban turnip tusk twilight'
+' umbrella unicorn upland vanilla velvet vendor venture vertigo vessel vicar village vinyl'
+' violet volcano voyage waffle wagon walnut warden wattle weasel weaver welder whisker'
+' willow windmill winter wombat wonder woodland wrangle yarrow yonder zenith zephyr zigzag'
).trim().split(/\s+/);

function pick(n) {
  const out = [];
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) out.push(WORDS[buf[i] % WORDS.length]);
  return out;
}
function generate(words) {
  const n = words || 5;
  const digits = new Uint32Array(1); crypto.getRandomValues(digits);
  const sym = '!@#$%&*?'[crypto.getRandomValues(new Uint32Array(1))[0] % 8];
  const parts = pick(n);
  // Capitalise one word so the policy's uppercase/symbol rule is met honestly.
  const capAt = crypto.getRandomValues(new Uint32Array(1))[0] % n;
  parts[capAt] = parts[capAt][0].toUpperCase() + parts[capAt].slice(1);
  return parts.join('-') + sym + (10 + (digits[0] % 90));
}
function entropyBits(n) {
  // words + one of 8 symbols + a 2-digit number
  return Math.round(n * Math.log2(WORDS.length) + Math.log2(8) + Math.log2(90));
}

const args = process.argv.slice(2);
const email = (args.find(a => !a.startsWith('--')) || '').trim().toLowerCase();
const showOnly = args.includes('--show-only');
const wi = args.indexOf('--words');
const nWords = wi >= 0 ? Math.max(4, Math.min(8, parseInt(args[wi + 1], 10) || 5)) : 5;

if (!email && !showOnly) {
  console.error('Usage: node backend/setup.js your@email [--words 5] [--show-only]');
  process.exit(1);
}

let pw = generate(nWords);
let guard = 0;
while (passwordProblems(pw).length && guard++ < 20) pw = generate(nWords);
const problems = passwordProblems(pw);
if (problems.length) { console.error('Could not generate a compliant password:', problems.join(', ')); process.exit(1); }

const line = '─'.repeat(64);
console.log('\n' + line);
console.log('  YOUR OWNER PASSWORD — shown once, never saved anywhere');
console.log(line);
console.log('\n    ' + pw + '\n');
console.log(`  ${nWords} words · about ${entropyBits(nWords)} bits of entropy`);
console.log('  Put it in a password manager NOW. This terminal is the only copy.');
console.log(line + '\n');

if (showOnly) {
  console.log('  --show-only: no account was created.');
  console.log('  To create the owner account:');
  console.log(`    OWNER_EMAIL='${email || 'your@email'}' BOOTSTRAP_OWNER_PASSWORD='<the password above>' \\`);
  console.log('      node backend/server.js\n');
  process.exit(0);
}

const dbPath = process.env.DB_PATH || './recomp.sqlite';
const db = nodeDb(DatabaseSync, dbPath);
db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
const r = await bootstrapOwner(db, { OWNER_EMAIL: email, OWNER_NAME: process.env.OWNER_NAME || 'Owner',
                                     BOOTSTRAP_OWNER_PASSWORD: pw }, Date.now());
if (!r.ok) {
  console.error('  Not created: ' + (r.message || r.reason));
  if (r.reason === 'already_bootstrapped' || r.reason === 'owner_exists') {
    console.error('  An owner already exists in ' + dbPath + '. Delete the database to start over,');
    console.error('  or change the password from inside the app.');
  }
  db.close(); process.exit(1);
}
console.log(`  Owner account created: ${r.email}`);
console.log(`  Database: ${dbPath}`);
console.log('  You must change this password on first login.\n');
console.log('  Start the server:');
console.log(`    DB_PATH='${dbPath}' node backend/server.js\n`);
db.close();
