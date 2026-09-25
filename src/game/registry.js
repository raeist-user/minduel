// Every playable game, keyed by id. Adding a new game later is: write
// games/foo.js exporting a BaseGame subclass with a static `id`, add it here.
const MathDuel = require('./games/mathduel');
const WpmDuel = require('./games/wpmduel');
const WordChain = require('./games/wordchain');
const SpellTheMost = require('./games/spellthemost');
const GuessCountry = require('./games/guesscountry');
const WikiRace = require('./games/wikirace');

const GAMES = [MathDuel, WpmDuel, WordChain, SpellTheMost, GuessCountry, WikiRace];
const BY_ID = Object.fromEntries(GAMES.map((G) => [G.id, G]));

// Random Matchmaking drops you into a random one of these (quick-play style).
// Wiki Race is excluded from the random pool: a 10-minute commitment doesn't
// fit "quick play" the way a 30s-2min game does. It's still fully playable,
// just chosen deliberately from the games list, not by the random button.
const QUICKPLAY_IDS = ['mathduel', 'wpmduel', 'wordchain', 'spellthemost', 'guesscountry'];

module.exports = { GAMES, BY_ID, QUICKPLAY_IDS };
