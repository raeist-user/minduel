// Typing-race source text: short public-domain-style filler sentences (written
// for this app, not copied from anywhere) plus a pool of standalone sentences
// for the "10 sentence" mode. Add more freely — the game just needs arrays of
// strings with no leading/trailing space and ending punctuation.
const PARAGRAPHS = [
  "The old lighthouse keeper climbed the spiral stairs every evening, counting each step out of habit rather than need, and by the time he reached the lamp room his breath had settled into the same steady rhythm the sea kept below him.",
  "Rain had been falling since noon, turning the dusty road into a dark ribbon that curled past the bakery, the shuttered market, and the small square where children usually played but which now sat empty under a single flickering streetlamp.",
  "She read the letter twice before folding it back into its envelope, not because the words had changed but because she wanted to be certain she had understood them the first time, and only then did she allow herself to smile.",
  "Somewhere between the third and fourth floor the elevator groaned to a stop, and for a moment nobody moved, as if silence alone might convince the machine to reconsider and continue its slow climb toward the offices above.",
  "The garden had grown wild in the years since anyone tended it, vines pulling at the fence posts and weeds crowding the paths, yet a single row of tulips still returned each spring, stubborn and bright against the tangle.",
  "He measured the flour twice, once from habit and once from doubt, then set the bowl aside and stared out the kitchen window at the neighbor's cat, which had taken to sitting on the fence at exactly this hour every single day.",
  "The train pulled away from the platform slower than expected, giving her just enough time to notice the stranger who had been standing near the ticket booth was now walking briskly alongside the tracks, watching the windows pass.",
  "By the time the storm reached the coast, most of the fishing boats had already been pulled ashore and tied down twice over, though a few stubborn captains stood at the harbor wall anyway, arguing about whether it was truly necessary.",
  "The professor paused halfway through the lecture, chalk still raised, and admitted that the proof on the board was wrong, then spent the next ten minutes rebuilding it from scratch while the room grew quieter and more attentive.",
  "A single candle burned on the windowsill long after midnight, not for light, since the room had electricity, but because the old woman found it easier to think while watching something small and steady flicker in the dark.",
];

const SENTENCES = [
  "Practice does not make perfect, it makes permanent.",
  "The quickest way to learn a language is to embarrass yourself in it daily.",
  "A ship in harbor is safe, but that is not what ships are built for.",
  "Curiosity is the engine of achievement.",
  "Small steps in the right direction can turn out to be the biggest step of your life.",
  "The expert in anything was once a beginner who refused to quit.",
  "Discipline is choosing between what you want now and what you want most.",
  "A goal without a plan is just a wish.",
  "The obstacle in the path becomes the path.",
  "Every mistake you make is a rule you now understand.",
  "Simplicity is the ultimate form of sophistication.",
  "Fortune favors the prepared mind.",
  "You do not rise to the level of your goals, you fall to the level of your systems.",
  "Patience is bitter, but its fruit is sweet.",
  "The best time to plant a tree was twenty years ago, the second best time is now.",
  "Clarity comes from action, not thought.",
  "What gets measured gets improved.",
  "Comfort is the enemy of progress.",
  "Consistency beats intensity when intensity cannot be sustained.",
  "An idea that is not shared is worth very little.",
];

module.exports = { PARAGRAPHS, SENTENCES };
