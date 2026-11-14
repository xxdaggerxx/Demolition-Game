// Level definitions. World is 1600 x 900 units, ground at y = 820.
// The target building is centred on `x`. Neighbours define the "lot":
// everything between the inner edges of the two neighbours is the safe zone.
(function (root) {
  const LEVELS = [
    {
      id: 1,
      name: 'First Job',
      blurb: 'A small office block with plenty of room around it. Cut the ground-floor columns.',
      bays: 4, floors: 5, bayW: 64, floorH: 58, x: 800,
      neighbors: [
        { x: 420, w: 180, h: 200, color: '#5aa9e6', style: 'office' },
        { x: 1180, w: 170, h: 240, color: '#f4a259', style: 'brick' },
      ],
      maxCharges: 8, planTime: 90,
    },
    {
      id: 2,
      name: 'Downtown Tower',
      blurb: 'Taller and narrower. Make it fall straight down — not sideways.',
      bays: 4, floors: 9, bayW: 60, floorH: 56, x: 800,
      neighbors: [
        { x: 505, w: 160, h: 330, color: '#8ac926', style: 'office' },
        { x: 1105, w: 170, h: 280, color: '#ff6b6b', style: 'brick' },
      ],
      maxCharges: 10, planTime: 90,
    },
    {
      id: 3,
      name: 'Tight Squeeze',
      blurb: 'The neighbours are inches away. Keep your charges small.',
      bays: 5, floors: 7, bayW: 58, floorH: 56, x: 800,
      neighbors: [
        { x: 545, w: 150, h: 420, color: '#c77dff', style: 'office' },
        { x: 1060, w: 160, h: 380, color: '#4ecdc4', style: 'brick' },
      ],
      maxCharges: 12, planTime: 100,
    },
    {
      id: 4,
      name: 'The Wide Load',
      blurb: 'A long, low warehouse. Charges need to be spread out.',
      bays: 8, floors: 4, bayW: 62, floorH: 60, x: 800,
      neighbors: [
        { x: 410, w: 140, h: 300, color: '#ffbe0b', style: 'brick' },
        { x: 1195, w: 150, h: 260, color: '#3a86ff', style: 'office' },
      ],
      maxCharges: 14, planTime: 100,
    },
    {
      id: 5,
      name: 'The Needle',
      blurb: 'A slender skyscraper hemmed in by towers. Sequence your delays!',
      bays: 3, floors: 13, bayW: 62, floorH: 54, x: 800,
      neighbors: [
        { x: 575, w: 150, h: 480, color: '#ef476f', style: 'glass' },
        { x: 1025, w: 150, h: 520, color: '#06d6a0', style: 'glass' },
      ],
      maxCharges: 12, planTime: 120,
    },
  ];
  root.LEVELS = LEVELS;
  if (typeof module !== 'undefined') module.exports = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
