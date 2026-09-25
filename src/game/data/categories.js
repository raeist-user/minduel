// "Spell the Most" categories. Each entry is a canonical name plus any aliases
// a player might reasonably type; matching is case/space/punctuation-insensitive
// (see normalize() in games/spellthemost.js) and only needs to match ONE
// alias, not the canonical spelling, so "usa" and "united states" both count
// for the same country.
//
// Add a category by pushing { id, label, items: [{ name, aliases: [...] }] }.

const a = (name, ...aliases) => ({ name, aliases });

const ANIMALS = [
  a('lion'), a('tiger'), a('elephant'), a('giraffe'), a('zebra'), a('gorilla'), a('chimpanzee'),
  a('kangaroo'), a('koala'), a('panda'), a('polar bear'), a('grizzly bear'), a('wolf'), a('fox'),
  a('deer'), a('moose'), a('elk'), a('bison'), a('buffalo'), a('rhino', 'rhinoceros'), a('hippo', 'hippopotamus'),
  a('cheetah'), a('leopard'), a('jaguar'), a('hyena'), a('meerkat'), a('otter'), a('beaver'), a('raccoon'),
  a('squirrel'), a('rabbit'), a('hare'), a('hedgehog'), a('bat'), a('camel'), a('llama'), a('alpaca'),
  a('horse'), a('donkey'), a('pig'), a('cow'), a('sheep'), a('goat'), a('chicken'), a('duck'), a('goose'),
  a('turkey'), a('peacock'), a('ostrich'), a('penguin'), a('flamingo'), a('parrot'), a('eagle'), a('hawk'),
  a('falcon'), a('owl'), a('crow'), a('raven'), a('sparrow'), a('pigeon'), a('swan'), a('pelican'), a('woodpecker'),
  a('crocodile'), a('alligator'), a('snake'), a('cobra'), a('python'), a('viper'), a('lizard'), a('gecko'),
  a('iguana'), a('chameleon'), a('turtle'), a('tortoise'), a('frog'), a('toad'), a('salamander'),
  a('shark'), a('whale'), a('dolphin'), a('orca'), a('seal'), a('walrus'), a('octopus'), a('squid'),
  a('jellyfish'), a('starfish'), a('crab'), a('lobster'), a('shrimp'), a('clam'), a('oyster'), a('snail'),
  a('spider'), a('scorpion'), a('ant'), a('bee'), a('wasp'), a('butterfly'), a('moth'), a('beetle'),
  a('grasshopper'), a('cricket'), a('dragonfly'), a('mosquito'), a('fly'), a('cat'), a('dog'), a('wolverine'),
  a('sloth'), a('armadillo'), a('anteater'), a('platypus'), a('bat ray', 'stingray'), a('mole'), a('mouse'), a('rat'),
];

const PRESIDENTS = [
  a('george washington', 'washington'), a('john adams'), a('thomas jefferson', 'jefferson'),
  a('james madison', 'madison'), a('james monroe', 'monroe'), a('john quincy adams'),
  a('andrew jackson', 'jackson'), a('martin van buren', 'van buren'), a('william henry harrison'),
  a('john tyler', 'tyler'), a('james k polk', 'james polk', 'polk'), a('zachary taylor', 'taylor'),
  a('millard fillmore', 'fillmore'), a('franklin pierce', 'pierce'), a('james buchanan', 'buchanan'),
  a('abraham lincoln', 'lincoln'), a('andrew johnson'), a('ulysses s grant', 'ulysses grant', 'grant'),
  a('rutherford b hayes', 'rutherford hayes', 'hayes'), a('james a garfield', 'james garfield', 'garfield'),
  a('chester a arthur', 'chester arthur', 'arthur'), a('grover cleveland', 'cleveland'),
  a('benjamin harrison'), a('william mckinley', 'mckinley'), a('theodore roosevelt', 'teddy roosevelt'),
  a('william howard taft', 'taft'), a('woodrow wilson', 'wilson'), a('warren g harding', 'warren harding', 'harding'),
  a('calvin coolidge', 'coolidge'), a('herbert hoover', 'hoover'), a('franklin d roosevelt', 'franklin roosevelt', 'fdr'),
  a('harry s truman', 'harry truman', 'truman'), a('dwight d eisenhower', 'dwight eisenhower', 'eisenhower', 'ike'),
  a('john f kennedy', 'john kennedy', 'jfk'), a('lyndon b johnson', 'lyndon johnson', 'lbj'),
  a('richard nixon', 'nixon'), a('gerald ford', 'ford'), a('jimmy carter', 'carter'),
  a('ronald reagan', 'reagan'), a('george h w bush', 'george bush sr', 'bush sr'),
  a('bill clinton', 'clinton'), a('george w bush', 'george bush jr', 'bush jr'),
  a('barack obama', 'obama'), a('donald trump', 'trump'), a('joe biden', 'joseph biden', 'biden'),
];

const COUNTRIES = [
  a('afghanistan'), a('albania'), a('algeria'), a('andorra'), a('angola'), a('argentina'), a('armenia'),
  a('australia'), a('austria'), a('azerbaijan'), a('bahamas'), a('bahrain'), a('bangladesh'), a('barbados'),
  a('belarus'), a('belgium'), a('belize'), a('benin'), a('bhutan'), a('bolivia'), a('bosnia', 'bosnia and herzegovina'),
  a('botswana'), a('brazil'), a('brunei'), a('bulgaria'), a('burkina faso'), a('burundi'), a('cambodia'),
  a('cameroon'), a('canada'), a('chad'), a('chile'), a('china'), a('colombia'), a('comoros'), a('congo'),
  a('costa rica'), a('croatia'), a('cuba'), a('cyprus'), a('czech republic', 'czechia'), a('denmark'),
  a('djibouti'), a('dominica'), a('dominican republic'), a('ecuador'), a('egypt'), a('el salvador'),
  a('eritrea'), a('estonia'), a('eswatini', 'swaziland'), a('ethiopia'), a('fiji'), a('finland'), a('france'),
  a('gabon'), a('gambia'), a('georgia'), a('germany'), a('ghana'), a('greece'), a('grenada'), a('guatemala'),
  a('guinea'), a('guyana'), a('haiti'), a('honduras'), a('hungary'), a('iceland'), a('india'), a('indonesia'),
  a('iran'), a('iraq'), a('ireland'), a('israel'), a('italy'), a('jamaica'), a('japan'), a('jordan'),
  a('kazakhstan'), a('kenya'), a('kiribati'), a('kuwait'), a('kyrgyzstan'), a('laos'), a('latvia'), a('lebanon'),
  a('lesotho'), a('liberia'), a('libya'), a('liechtenstein'), a('lithuania'), a('luxembourg'), a('madagascar'),
  a('malawi'), a('malaysia'), a('maldives'), a('mali'), a('malta'), a('mauritania'), a('mauritius'), a('mexico'),
  a('moldova'), a('monaco'), a('mongolia'), a('montenegro'), a('morocco'), a('mozambique'), a('myanmar', 'burma'),
  a('namibia'), a('nauru'), a('nepal'), a('netherlands', 'holland'), a('new zealand'), a('nicaragua'), a('niger'),
  a('nigeria'), a('north korea'), a('north macedonia', 'macedonia'), a('norway'), a('oman'), a('pakistan'),
  a('palau'), a('panama'), a('papua new guinea'), a('paraguay'), a('peru'), a('philippines'), a('poland'),
  a('portugal'), a('qatar'), a('romania'), a('russia'), a('rwanda'), a('samoa'), a('san marino'),
  a('saudi arabia'), a('senegal'), a('serbia'), a('seychelles'), a('sierra leone'), a('singapore'), a('slovakia'),
  a('slovenia'), a('solomon islands'), a('somalia'), a('south africa'), a('south korea', 'korea'), a('south sudan'),
  a('spain'), a('sri lanka'), a('sudan'), a('suriname'), a('sweden'), a('switzerland'), a('syria'), a('taiwan'),
  a('tajikistan'), a('tanzania'), a('thailand'), a('togo'), a('tonga'), a('trinidad and tobago', 'trinidad'),
  a('tunisia'), a('turkey'), a('turkmenistan'), a('tuvalu'), a('uganda'), a('ukraine'),
  a('united arab emirates', 'uae'), a('united kingdom', 'uk', 'britain', 'great britain'),
  a('united states', 'usa', 'us', 'america', 'united states of america'), a('uruguay'), a('uzbekistan'),
  a('vanuatu'), a('vatican city', 'vatican'), a('venezuela'), a('vietnam'), a('yemen'), a('zambia'), a('zimbabwe'),
];

const FAST_FOOD = [
  a('mcdonalds', "mcdonald's"), a('burger king'), a('wendys', "wendy's"), a('kfc', 'kentucky fried chicken'),
  a('taco bell'), a('subway'), a('pizza hut'), a('dominos', "domino's"), a('papa johns', "papa john's"),
  a('chick fil a', 'chickfila', "chick-fil-a"), a('popeyes'), a('arbys', "arby's"), a('sonic'),
  a('dairy queen'), a('chipotle'), a('five guys'), a('in n out', "in-n-out"), a('shake shack'),
  a('jack in the box'), a('carls jr', "carl's jr"), a('hardees', "hardee's"), a('little caesars', "little caesar's"),
  a('panda express'), a('panera bread', 'panera'), a('starbucks'), a('dunkin', "dunkin' donuts", 'dunkin donuts'),
  a('krispy kreme'), a('white castle'), a('culvers', "culver's"), a('whataburger'), a('el pollo loco'),
  a('long john silvers', "long john silver's"), a('checkers'), a('rally\u2019s', 'rallys'), a('zaxbys', "zaxby's"),
  a('wingstop'), a('raising canes', "raising cane's"), a('del taco'), a('qdoba'), a('moes southwest grill', "moe's"),
  a('jimmy johns', "jimmy john's"), a('firehouse subs'),
];

const CATEGORIES = [
  { id: 'animals', label: 'Animals', items: ANIMALS },
  { id: 'presidents', label: 'US Presidents', items: PRESIDENTS },
  { id: 'countries', label: 'Countries', items: COUNTRIES },
  { id: 'fastfood', label: 'Fast Food Chains', items: FAST_FOOD },
];

module.exports = { CATEGORIES };
