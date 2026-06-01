// Kaya Tycoon — static game data, ported verbatim from the prototype.
//   • BASE       — the 40-tile board, mechanics only (no names, no currency)
//   • PACKS      — 12 country city-packs (World Cities theme) + home currency
//   • UNIVERSE   — the Kaya Universe theme (planets/ports/sun-moon/black-hole)
//   • ADVENTURE / SURPRISE — the two card decks
// Numbers are the BASE economy (US$ ×1); the engine scales them per currency.

import type {
  BaseTile, Group, Pack, CountryKey, CornerDef, Deck,
} from './types';

export const TOKENS = ['🎩', '🐬', '🚗', '🐱', '🚀', '⚽', '🦊', '👑', '🐢', '🍕'];
export const PCOLORS = ['#ff5d8f', '#3a86ff', '#2ecc71', '#ffd23f', '#7b2ff7', '#16c2c2'];

/** Functional colour-set hues (gameplay, not branding) + airport/utility. */
export const GROUP_COLORS: Record<Group | 'airport' | 'utility', string> = {
  brown: '#8d5524', lblue: '#7fd1ff', pink: '#ff6fb5', orange: '#ff8c42',
  red: '#ef476f', yellow: '#ffd23f', green: '#2ecc71', dblue: '#3a86ff',
  airport: '#241452', utility: '#9aa0b5',
};

export const COLOR_NAME: Record<Group, string> = {
  brown: 'brown', lblue: 'sky-blue', pink: 'pink', orange: 'orange',
  red: 'red', yellow: 'yellow', green: 'green', dblue: 'navy',
};

export const START_CASH = 1500;
export const PASS_GO = 200;
export const STEP_MS = 150;
export const JAIL_FEE = 50;

// ── BASE board (mechanics only) ──────────────────────────────────────────
function P(group: Group, price: number, rent: number[], house: number, mort: number): BaseTile {
  return { type: 'prop', group, price, rent, houseCost: house, mortgage: mort };
}

export const BASE: BaseTile[] = [
  { type: 'start' },
  P('brown', 60, [2, 10, 30, 90, 160, 250], 50, 30),
  { type: 'card', deck: 'surprise' },
  P('brown', 60, [4, 20, 60, 180, 320, 450], 50, 30),
  { type: 'tax', amount: 200 },
  { type: 'airport', price: 200, mortgage: 100 },
  P('lblue', 100, [6, 30, 90, 270, 400, 550], 50, 50),
  { type: 'card', deck: 'adventure' },
  P('lblue', 100, [6, 30, 90, 270, 400, 550], 50, 50),
  P('lblue', 120, [8, 40, 100, 300, 450, 600], 50, 60),
  { type: 'jail' },
  P('pink', 140, [10, 50, 150, 450, 625, 750], 100, 70),
  { type: 'utility', price: 150, mortgage: 75 },
  P('pink', 140, [10, 50, 150, 450, 625, 750], 100, 70),
  P('pink', 160, [12, 60, 180, 500, 700, 900], 100, 80),
  { type: 'airport', price: 200, mortgage: 100 },
  P('orange', 180, [14, 70, 200, 550, 750, 950], 100, 90),
  { type: 'card', deck: 'surprise' },
  P('orange', 180, [14, 70, 200, 550, 750, 950], 100, 90),
  P('orange', 200, [16, 80, 220, 600, 800, 1000], 100, 100),
  { type: 'parking' },
  P('red', 220, [18, 90, 250, 700, 875, 1050], 150, 110),
  { type: 'card', deck: 'adventure' },
  P('red', 220, [18, 90, 250, 700, 875, 1050], 150, 110),
  P('red', 240, [20, 100, 300, 750, 925, 1100], 150, 120),
  { type: 'airport', price: 200, mortgage: 100 },
  P('yellow', 260, [22, 110, 330, 800, 975, 1150], 150, 130),
  P('yellow', 260, [22, 110, 330, 800, 975, 1150], 150, 130),
  { type: 'utility', price: 150, mortgage: 75 },
  P('yellow', 280, [24, 120, 360, 850, 1025, 1200], 150, 140),
  { type: 'gotojail' },
  P('green', 300, [26, 130, 390, 900, 1100, 1275], 200, 150),
  P('green', 300, [26, 130, 390, 900, 1100, 1275], 200, 150),
  { type: 'card', deck: 'surprise' },
  P('green', 320, [28, 150, 450, 1000, 1200, 1400], 200, 160),
  { type: 'airport', price: 200, mortgage: 100 },
  { type: 'card', deck: 'adventure' },
  P('dblue', 350, [35, 175, 500, 1100, 1300, 1500], 200, 175),
  { type: 'tax', amount: 100 },
  P('dblue', 400, [50, 200, 600, 1400, 1700, 2000], 200, 200),
];

export const GROUP_SIZE: Record<Group, number> = {
  brown: 2, lblue: 3, pink: 3, orange: 3, red: 3, yellow: 3, green: 3, dblue: 2,
};
export const GROUP_IDX: Record<Group, number[]> = {
  brown: [1, 3], lblue: [6, 8, 9], pink: [11, 13, 14], orange: [16, 18, 19],
  red: [21, 23, 24], yellow: [26, 27, 29], green: [31, 32, 34], dblue: [37, 39],
};
export const AIRPORT_IDX = [5, 15, 25, 35];
export const UTIL_IDX = [12, 28];
export const TAX_IDX = [4, 38];

// ── Country city-packs (cheap → premium) ─────────────────────────────────
export const PACKS: Record<CountryKey, Pack> = {
  // ---- East Africa (neighbours) ----
  tanzania: {
    flag: '🇹🇿', label: 'Tanzania', continent: 'Africa',
    currency: { symbol: 'TSh ', name: 'TZ Shillings', rate: 2500 },
    groups: {
      brown: ['Lindi', 'Babati'], lblue: ['Sumbawanga', 'Njombe', 'Singida'],
      pink: ['Kigoma', 'Songea', 'Musoma'], orange: ['Iringa', 'Shinyanga', 'Mtwara'],
      red: ['Bukoba', 'Tabora', 'Moshi'], yellow: ['Tanga', 'Morogoro', 'Mbeya'],
      green: ['Zanzibar', 'Arusha', 'Mwanza'], dblue: ['Dodoma', 'Dar es Salaam'],
    },
    airports: ['Mwanza Airport', 'Kilimanjaro Intl', 'Zanzibar Airport', 'Nyerere Intl'],
    utils: ['TANESCO Power', 'DAWASA Water'], tax: ['TRA Levy', 'Road Toll'],
  },
  kenya: {
    flag: '🇰🇪', label: 'Kenya', continent: 'Africa',
    currency: { symbol: 'KSh ', name: 'KE Shillings', rate: 130 },
    groups: {
      brown: ['Voi', 'Bungoma'], lblue: ['Garissa', 'Kitale', 'Embu'],
      pink: ['Kericho', 'Meru', 'Machakos'], orange: ['Kakamega', 'Nyeri', 'Naivasha'],
      red: ['Eldoret', 'Thika', 'Nakuru'], yellow: ['Malindi', 'Kisumu', 'Nanyuki'],
      green: ['Diani', 'Lamu', 'Kilifi'], dblue: ['Mombasa', 'Nairobi'],
    },
    airports: ['Kisumu Airport', 'Eldoret Intl', 'Moi Intl', 'JKIA Nairobi'],
    utils: ['Kenya Power', 'Nairobi Water'], tax: ['KRA Levy', 'Road Toll'],
  },
  uganda: {
    flag: '🇺🇬', label: 'Uganda', continent: 'Africa',
    currency: { symbol: 'USh ', name: 'UG Shillings', rate: 3700 },
    groups: {
      brown: ['Tororo', 'Soroti'], lblue: ['Arua', 'Lira', 'Kabale'],
      pink: ['Hoima', 'Masindi', 'Fort Portal'], orange: ['Kasese', 'Mityana', 'Mubende'],
      red: ['Mbale', 'Masaka', 'Gulu'], yellow: ['Wakiso', 'Mukono', 'Mbarara'],
      green: ['Jinja', 'Njeru', 'Iganga'], dblue: ['Entebbe', 'Kampala'],
    },
    airports: ['Arua Airport', 'Gulu Airport', 'Kasese Airstrip', 'Entebbe Intl'],
    utils: ['UMEME Power', 'NWSC Water'], tax: ['URA Levy', 'Road Toll'],
  },
  rwanda: {
    flag: '🇷🇼', label: 'Rwanda', continent: 'Africa',
    currency: { symbol: 'FRw ', name: 'Rwf Francs', rate: 1300 },
    groups: {
      brown: ['Nyagatare', 'Kayonza'], lblue: ['Rwamagana', 'Gicumbi', 'Ngoma'],
      pink: ['Nyanza', 'Kibuye', 'Rusizi'], orange: ['Byumba', 'Kibungo', 'Kabuga'],
      red: ['Ruhengeri', 'Nyamata', 'Karongi'], yellow: ['Rubavu', 'Huye', 'Nyamagabe'],
      green: ['Muhanga', 'Butare', 'Cyangugu'], dblue: ['Musanze', 'Kigali'],
    },
    airports: ['Kamembe Airport', 'Gisenyi Airport', 'Butare Airstrip', 'Kigali Intl'],
    utils: ['REG Power', 'WASAC Water'], tax: ['RRA Levy', 'Road Toll'],
  },
  // ---- Africa (other) ----
  nigeria: {
    flag: '🇳🇬', label: 'Nigeria', continent: 'Africa',
    currency: { symbol: '₦', name: 'Naira', rate: 1600 },
    groups: {
      brown: ['Makurdi', 'Lokoja'], lblue: ['Minna', 'Yola', 'Bauchi'],
      pink: ['Jos', 'Ilorin', 'Sokoto'], orange: ['Maiduguri', 'Calabar', 'Owerri'],
      red: ['Enugu', 'Benin City', 'Kaduna'], yellow: ['Aba', 'Onitsha', 'Warri'],
      green: ['Port Harcourt', 'Ibadan', 'Abuja'], dblue: ['Kano', 'Lagos'],
    },
    airports: ['Kano Airport', 'Enugu Airport', 'Abuja Intl', 'Lagos Intl'],
    utils: ['PHCN Power', 'Lagos Water'], tax: ['FIRS Levy', 'Road Toll'],
  },
  southafrica: {
    flag: '🇿🇦', label: 'South Africa', continent: 'Africa',
    currency: { symbol: 'R ', name: 'Rand', rate: 18 },
    groups: {
      brown: ['Mahikeng', 'Polokwane'], lblue: ['Kimberley', 'Rustenburg', 'Nelspruit'],
      pink: ['Welkom', 'George', 'Bloemfontein'], orange: ['East London', 'Pietermaritzburg', 'Soweto'],
      red: ['Centurion', 'Stellenbosch', 'Gqeberha'], yellow: ['Pretoria', 'Durban', 'Umhlanga'],
      green: ['Sandton', 'Camps Bay', 'Constantia'], dblue: ['Cape Town', 'Johannesburg'],
    },
    airports: ['George Airport', 'King Shaka Durban', 'Cape Town Intl', 'OR Tambo JHB'],
    utils: ['Eskom Power', 'Rand Water'], tax: ['SARS Levy', 'Road Toll'],
  },
  // ---- Europe ----
  uk: {
    flag: '🇬🇧', label: 'United Kingdom', continent: 'Europe',
    currency: { symbol: '£', name: 'Pounds', rate: 0.8 },
    groups: {
      brown: ['Hull', 'Sunderland'], lblue: ['Belfast', 'Swansea', 'Cardiff'],
      pink: ['Leeds', 'Sheffield', 'Nottingham'], orange: ['Bristol', 'Newcastle', 'Glasgow'],
      red: ['Liverpool', 'Birmingham', 'Leicester'], yellow: ['Manchester', 'Brighton', 'York'],
      green: ['Oxford', 'Cambridge', 'Bath'], dblue: ['Edinburgh', 'London'],
    },
    airports: ['Manchester Airport', 'Edinburgh Airport', 'Gatwick', 'Heathrow'],
    utils: ['National Grid', 'Thames Water'], tax: ['HMRC Levy', 'Road Toll'],
  },
  // ---- Asia ----
  india: {
    flag: '🇮🇳', label: 'India', continent: 'Asia',
    currency: { symbol: '₹', name: 'Rupees', rate: 85 },
    groups: {
      brown: ['Patna', 'Kanpur'], lblue: ['Lucknow', 'Bhopal', 'Indore'],
      pink: ['Nagpur', 'Surat', 'Jaipur'], orange: ['Ahmedabad', 'Pune', 'Kochi'],
      red: ['Hyderabad', 'Chennai', 'Kolkata'], yellow: ['Goa', 'Chandigarh', 'Mysuru'],
      green: ['Gurugram', 'Bengaluru', 'Noida'], dblue: ['New Delhi', 'Mumbai'],
    },
    airports: ['Kolkata Airport', 'Chennai Intl', 'Delhi Intl', 'Mumbai Intl'],
    utils: ['Power Grid India', 'Jal Board Water'], tax: ['GST Levy', 'Road Toll'],
  },
  // ---- North America ----
  usa: {
    flag: '🇺🇸', label: 'United States', continent: 'N. America',
    currency: { symbol: '$', name: 'US Dollars', rate: 1 },
    groups: {
      brown: ['Detroit', 'Cleveland'], lblue: ['Memphis', 'Kansas City', 'Columbus'],
      pink: ['Phoenix', 'Dallas', 'Atlanta'], orange: ['Denver', 'Austin', 'Seattle'],
      red: ['Las Vegas', 'Philadelphia', 'Houston'], yellow: ['San Diego', 'Washington DC', 'Chicago'],
      green: ['Los Angeles', 'Miami', 'San Francisco'], dblue: ['Boston', 'New York'],
    },
    airports: ['Chicago OHare', 'LAX', 'SFO', 'JFK New York'],
    utils: ['National Power', 'City Water'], tax: ['IRS Levy', 'Road Toll'],
  },
  // ---- South America ----
  brazil: {
    flag: '🇧🇷', label: 'Brazil', continent: 'S. America',
    currency: { symbol: 'R$ ', name: 'Reais', rate: 5 },
    groups: {
      brown: ['Belém', 'Manaus'], lblue: ['Natal', 'Maceió', 'Vitória'],
      pink: ['Recife', 'Fortaleza', 'Goiânia'], orange: ['Cuiabá', 'Santos', 'Campinas'],
      red: ['Curitiba', 'Porto Alegre', 'Salvador'], yellow: ['Brasília', 'Florianópolis', 'Niterói'],
      green: ['Belo Horizonte', 'Búzios', 'Gramado'], dblue: ['Rio de Janeiro', 'São Paulo'],
    },
    airports: ['Manaus Airport', 'Brasília Intl', 'Galeão Rio', 'Guarulhos SP'],
    utils: ['Eletrobras Power', 'Sabesp Water'], tax: ['Receita Levy', 'Road Toll'],
  },
  // ---- Oceania ----
  australia: {
    flag: '🇦🇺', label: 'Australia', continent: 'Oceania',
    currency: { symbol: 'A$ ', name: 'AU Dollars', rate: 1.5 },
    groups: {
      brown: ['Darwin', 'Hobart'], lblue: ['Cairns', 'Townsville', 'Geelong'],
      pink: ['Newcastle', 'Wollongong', 'Launceston'], orange: ['Ballarat', 'Toowoomba', 'Bendigo'],
      red: ['Canberra', 'Adelaide', 'Perth'], yellow: ['Brisbane', 'Gold Coast', 'Fremantle'],
      green: ['Byron Bay', 'Manly', 'Bondi'], dblue: ['Melbourne', 'Sydney'],
    },
    airports: ['Perth Airport', 'Brisbane Airport', 'Tullamarine', 'Kingsford Smith'],
    utils: ['AusGrid Power', 'Sydney Water'], tax: ['ATO Levy', 'Road Toll'],
  },
  // ---- World mix ----
  global: {
    flag: '🌍', label: 'Global Tour', continent: 'World',
    currency: { symbol: '$', name: 'US Dollars', rate: 1 },
    groups: {
      brown: ['Kathmandu', 'Hanoi'], lblue: ['Nairobi', 'Cairo', 'Lagos'],
      pink: ['Bangkok', 'Istanbul', 'Lima'], orange: ['Mumbai', 'Rio', 'Cape Town'],
      red: ['Dubai', 'Rome', 'Berlin'], yellow: ['Barcelona', 'Amsterdam', 'Toronto'],
      green: ['Singapore', 'Sydney', 'Tokyo'], dblue: ['London', 'New York'],
    },
    airports: ['Coastal Airport', 'Mountain Airport', 'Desert Airport', 'Harbor Airport'],
    utils: ['Power Grid', 'Water Works'], tax: ['Customs Duty', 'Airport Tax'],
  },
};

export const NEIGHBOURS: Record<CountryKey, CountryKey[]> = {
  tanzania: ['kenya', 'uganda', 'rwanda'], kenya: ['tanzania', 'uganda'],
  uganda: ['kenya', 'tanzania', 'rwanda'], rwanda: ['uganda', 'tanzania'],
  nigeria: ['southafrica'], southafrica: ['nigeria'], uk: ['global'],
  india: ['global'], usa: ['brazil'], brazil: ['usa'], australia: ['global'], global: [],
};

/** The order country chips surface in setup: home, then neighbours, then the
 *  rest in PACKS declaration order. */
export function orderedCountries(home: CountryKey): CountryKey[] {
  const keys = Object.keys(PACKS);
  const neigh = NEIGHBOURS[home] || [];
  return [
    home,
    ...neigh.filter((k) => k !== home),
    ...keys.filter((k) => k !== home && !neigh.includes(k)),
  ];
}

// ── Themes ───────────────────────────────────────────────────────────────
type Corners = { start: CornerDef; jail: CornerDef; parking: CornerDef; gotojail: CornerDef };

export const CITY_CORNERS: Corners = {
  start: { e: '🏁', l: 'START' },
  jail: { e: '🛑', l: 'REST STOP', s: 'Just visiting' },
  parking: { e: '🏖️', l: 'HOLIDAY' },
  gotojail: { e: '⏰', l: 'GO TO TIME-OUT' },
};

export const UNIVERSE: {
  corners: Corners;
  airportE: string;
  utilE: Record<number, string>;
  names: Record<number, string>;
} = {
  corners: {
    start: { e: '🚀', l: 'BLAST OFF' },
    jail: { e: '🛰️', l: 'SPACE STATION', s: 'Just floating' },
    parking: { e: '☄️', l: 'COMET REST' },
    gotojail: { e: '🕳️', l: 'GO TO BLACK HOLE' },
  },
  airportE: '🛸',
  utilE: { 12: '☀️', 28: '🌙' },
  names: {
    1: 'Sprout', 3: 'Pebble', 5: 'Comet Port', 6: 'Breezy', 8: 'Cloudia', 9: 'Mistos',
    11: 'Coral', 12: 'Sun Power', 13: 'Petal', 14: 'Bloom', 15: 'Nebula Port',
    16: 'Ember', 18: 'Spark', 19: 'Blaze', 21: 'Magma', 23: 'Cinder', 24: 'Scorch',
    25: 'Orbit Port', 26: 'Sunny', 27: 'Gleam', 28: 'Moon Water', 29: 'Glow',
    31: 'Verda', 32: 'Fern', 34: 'Jade', 35: 'Star Port', 37: 'Nova', 39: 'Galaxia',
    4: 'Meteor Toll', 38: 'Star Tax',
  },
};

// ── Cards ────────────────────────────────────────────────────────────────
export interface CardEffect {
  move?: number;
  moveBy?: number;
  collect?: number;
  pay?: number;
  collectFromEach?: number;
  gotojail?: number;
  getoutfree?: number;
  nearestAirport?: number;
}
export interface Card { t: string; x: string; e: CardEffect }

export const ADVENTURE: Card[] = [
  { t: '🏁', x: 'Advance to START.', e: { move: 0 } },
  { t: '🔬', x: 'You won the school science fair! Collect %.', e: { collect: 100 } },
  { t: '⏰', x: 'Go to Time-Out. Do not pass START.', e: { gotojail: 1 } },
  { t: '🚲', x: 'Speeding on your bike — pay a % fine.', e: { pay: 30 } },
  { t: '🎂', x: "It's your birthday! Each player gives you %.", e: { collectFromEach: 20 } },
  { t: '🌆', x: 'Take a trip to the priciest city.', e: { move: 39 } },
  { t: '💰', x: 'The bank pays you a dividend of %.', e: { collect: 50 } },
  { t: '🎟️', x: 'Get Out of Time-Out Free — keep this card!', e: { getoutfree: 1 } },
  { t: '↩️', x: 'Go back 3 spaces.', e: { moveBy: -3 } },
  { t: '📚', x: 'Pay your school fees of %.', e: { pay: 80 } },
  { t: '🛫', x: 'Zoom to the nearest Airport/Port. Buy it if free, or pay double rent.', e: { nearestAirport: 1 } },
  { t: '🌟', x: 'Good deed of the day! Collect %.', e: { collect: 40 } },
];

export const SURPRISE: Card[] = [
  { t: '🧚', x: 'The tooth fairy visited! Collect %.', e: { collect: 20 } },
  { t: '🩺', x: "Doctor's visit — pay %.", e: { pay: 50 } },
  { t: '🪙', x: 'You found money on the ground. Collect %.', e: { collect: 10 } },
  { t: '🏖️', x: 'Holiday refund — collect %.', e: { collect: 100 } },
  { t: '👟', x: 'New shoes — pay %.', e: { pay: 50 } },
  { t: '🍀', x: "It's your lucky day! Collect %.", e: { collect: 200 } },
  { t: '🧹', x: 'Pocket money for helping at home — collect %.', e: { collect: 50 } },
  { t: '🎟️', x: 'Get Out of Time-Out Free — keep this card!', e: { getoutfree: 1 } },
  { t: '🏁', x: 'Go to START.', e: { move: 0 } },
  { t: '📖', x: 'Library fine — pay %.', e: { pay: 20 } },
  { t: '🎁', x: 'Grandma sends a gift — collect %.', e: { collect: 40 } },
  { t: '❤️', x: 'Donate to charity — pay % (it feels good!).', e: { pay: 30 } },
];

export function deck(d: Deck): Card[] {
  return d === 'adventure' ? ADVENTURE : SURPRISE;
}
