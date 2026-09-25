// Curated start/target pairs for Wiki Race. All are well-known, heavily
// cross-linked articles, so a solvable path in a handful of clicks always
// exists (the whole point of "vital article" hubs) without needing to
// precompute a path server-side. Add more pairs freely; keep both sides
// well-linked (avoid narrow stub articles).
const PAIRS = [
  ['Albert Einstein', 'Basketball'],
  ['Pizza', 'Mount Everest'],
  ['William Shakespeare', 'Tokyo'],
  ['Coffee', 'Ancient Rome'],
  ['The Beatles', 'Antarctica'],
  ['Leonardo da Vinci', 'Internet'],
  ['Great Wall of China', 'Video game'],
  ['Napoleon', 'Chocolate'],
  ['Amazon rainforest', 'Olympic Games'],
  ['Isaac Newton', 'Guitar'],
  ['Ancient Egypt', 'Smartphone'],
  ['Marie Curie', 'Football'],
  ['Mount Kilimanjaro', 'Jazz'],
  ['Charles Darwin', 'Sushi'],
  ['Statue of Liberty', 'Solar System'],
];

module.exports = { PAIRS };
