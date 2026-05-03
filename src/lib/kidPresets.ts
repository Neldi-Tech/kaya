// Curated chip suggestions for the kid identity editors. Both lists are
// suggestions only — parents can also free-text "+ Add custom".

export type Preset = { label: string; emoji: string };

export const INTERESTS: Preset[] = [
  // Sports
  { label: 'Football',     emoji: '⚽' },
  { label: 'Basketball',   emoji: '🏀' },
  { label: 'Swimming',     emoji: '🏊' },
  { label: 'Cycling',      emoji: '🚴' },
  { label: 'Running',      emoji: '🏃' },
  { label: 'Dancing',      emoji: '💃' },
  { label: 'Karate',       emoji: '🥋' },
  // Creative
  { label: 'Drawing',      emoji: '✏️' },
  { label: 'Painting',     emoji: '🎨' },
  { label: 'Music',        emoji: '🎵' },
  { label: 'Singing',      emoji: '🎤' },
  { label: 'Writing',      emoji: '✍️' },
  { label: 'Photography',  emoji: '📷' },
  { label: 'Crafts',       emoji: '🧶' },
  // Tech & games
  { label: 'Coding',       emoji: '💻' },
  { label: 'Robots',       emoji: '🤖' },
  { label: 'Video games',  emoji: '🎮' },
  { label: 'Lego',         emoji: '🧱' },
  { label: 'Chess',        emoji: '♟️' },
  { label: 'Puzzles',      emoji: '🧩' },
  // Nature
  { label: 'Animals',      emoji: '🐾' },
  { label: 'Plants',       emoji: '🌱' },
  { label: 'Astronomy',    emoji: '🌠' },
  { label: 'Hiking',       emoji: '🥾' },
  { label: 'Camping',      emoji: '⛺' },
  // Food & home
  { label: 'Cooking',      emoji: '🍳' },
  { label: 'Baking',       emoji: '🧁' },
  // Reading
  { label: 'Books',        emoji: '📚' },
  { label: 'Comics',       emoji: '💭' },
  { label: 'Stories',      emoji: '📖' },
];

export const ASPIRATIONS: Preset[] = [
  { label: 'Doctor',         emoji: '🩺' },
  { label: 'Engineer',       emoji: '🛠️' },
  { label: 'Pilot',          emoji: '✈️' },
  { label: 'Astronaut',      emoji: '🚀' },
  { label: 'Footballer',     emoji: '⚽' },
  { label: 'Singer',         emoji: '🎤' },
  { label: 'Artist',         emoji: '🎨' },
  { label: 'Teacher',        emoji: '👩‍🏫' },
  { label: 'Scientist',      emoji: '🔬' },
  { label: 'Inventor',       emoji: '💡' },
  { label: 'Chef',           emoji: '👨‍🍳' },
  { label: 'Writer',         emoji: '✍️' },
  { label: 'Architect',      emoji: '🏛️' },
  { label: 'Veterinarian',   emoji: '🐾' },
  { label: 'Programmer',     emoji: '💻' },
  { label: 'Entrepreneur',   emoji: '💼' },
  { label: 'Athlete',        emoji: '🏅' },
  { label: 'Musician',       emoji: '🎹' },
  { label: 'Actor',          emoji: '🎭' },
  { label: 'Photographer',   emoji: '📷' },
];

export const ASPIRATION_LIMIT = 3;
