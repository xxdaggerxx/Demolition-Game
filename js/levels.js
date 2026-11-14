// Level definitions. World is 1600 x 900 units, ground at y = 820.
// The target building is centred on `x`. The lot is the building footprint plus
// `lotPad` on each side; between the lot and the neighbours is the street,
// where cars park and bystanders wander in.
(function (root) {
  const LEVELS = [
    {
      id: 1,
      name: 'First Job',
      blurb: 'A small concrete office block. Cut the ground-floor columns — and shoo away anyone who wanders in!',
      material: 'concrete', bays: 4, floors: 5, bayW: 64, floorH: 58, x: 800, lotPad: 45,
      neighbors: [
        { x: 455, w: 180, h: 200, color: '#5aa9e6', style: 'office' },
        { x: 1140, w: 170, h: 240, color: '#f4a259', style: 'brick' },
      ],
      cars: [585],
      people: { every: 10, max: 2 },
      budget: 2500, maxCharges: 8, planTime: 90,
    },
    {
      id: 2,
      name: 'Downtown Tower',
      blurb: 'Taller, with a heavy water tank on the roof. Make it fall straight down — not sideways.',
      material: 'concrete', bays: 4, floors: 9, bayW: 60, floorH: 56, x: 800, lotPad: 35, roof: 'tank',
      neighbors: [
        { x: 495, w: 160, h: 330, color: '#8ac926', style: 'office' },
        { x: 1110, w: 170, h: 280, color: '#ff6b6b', style: 'brick' },
      ],
      cars: [990],
      people: { every: 8, max: 3 },
      budget: 3200, maxCharges: 10, planTime: 90,
    },
    {
      id: 3,
      name: 'Old Brick Mill',
      blurb: 'Brick crumbles easily — but that is a 200-year-old church next door. Hits on it cost double!',
      material: 'brick', bays: 5, floors: 5, bayW: 56, floorH: 54, x: 800, lotPad: 35,
      neighbors: [
        { x: 480, w: 160, h: 260, color: '#c77dff', style: 'office' },
        { x: 1120, w: 180, h: 190, color: '#d8cbb0', style: 'church', fragile: true },
      ],
      cars: [598],
      people: { every: 8, max: 3 },
      budget: 2400, maxCharges: 12, planTime: 100,
    },
    {
      id: 4,
      name: 'The Wide Load',
      blurb: 'A steel-framed warehouse. Steel bends instead of shattering — it needs strength 6+, or cutter charges.',
      material: 'steel', bays: 8, floors: 4, bayW: 62, floorH: 60, x: 800, lotPad: 30,
      neighbors: [
        { x: 400, w: 140, h: 300, color: '#ffbe0b', style: 'brick' },
        { x: 1205, w: 150, h: 260, color: '#3a86ff', style: 'office' },
      ],
      cars: [497, 1104],
      people: { every: 9, max: 3 },
      budget: 5200, maxCharges: 14, planTime: 110,
    },
    {
      id: 5,
      name: 'Glass Office',
      blurb: 'A glass curtain wall. Every blast sprays shards — and there is a billboard on the roof.',
      material: 'glass', bays: 4, floors: 8, bayW: 60, floorH: 56, x: 800, lotPad: 35, roof: 'sign',
      neighbors: [
        { x: 500, w: 150, h: 380, color: '#4ecdc4', style: 'glass' },
        { x: 1100, w: 160, h: 300, color: '#ef476f', style: 'brick' },
      ],
      cars: [612, 990],
      people: { every: 7, max: 3 },
      budget: 3400, maxCharges: 12, planTime: 100,
    },
    {
      id: 6,
      name: 'The Needle',
      blurb: 'A slender skyscraper hemmed in by towers, with a water tank up top. Sequence your delays!',
      material: 'concrete', bays: 3, floors: 13, bayW: 62, floorH: 54, x: 800, lotPad: 28, roof: 'tank',
      neighbors: [
        { x: 575, w: 150, h: 480, color: '#ef476f', style: 'glass' },
        { x: 1025, w: 150, h: 520, color: '#06d6a0', style: 'glass' },
      ],
      cars: [],
      people: { every: 6, max: 4 },
      budget: 4000, maxCharges: 12, planTime: 120,
    },
    {
      id: 7,
      name: 'Lean on Me',
      blurb: 'DIRECTIONAL JOB: topple this block LEFT into the empty lot. Cut the left side first and leave the right side as a hinge.',
      material: 'concrete', bays: 3, floors: 7, bayW: 60, floorH: 56, x: 920, lotPad: 25,
      topple: 'left', dropZone: [425, 805],
      neighbors: [
        { x: 330, w: 150, h: 260, color: '#ffbe0b', style: 'office' },
        { x: 1110, w: 140, h: 300, color: '#8338ec', style: 'brick' },
      ],
      cars: [],
      people: { every: 7, max: 3 },
      budget: 2800, maxCharges: 10, planTime: 110,
    },
    {
      id: 8,
      name: 'Timber!',
      blurb: 'DIRECTIONAL JOB: fell this tall brick tower RIGHT, along the empty lot. It is narrow and tall — the hinge matters!',
      material: 'brick', bays: 2, floors: 10, bayW: 46, floorH: 52, x: 560, lotPad: 18,
      topple: 'right', dropZone: [625, 1190],
      neighbors: [
        { x: 420, w: 150, h: 280, color: '#3a86ff', style: 'glass' },
        { x: 1290, w: 150, h: 320, color: '#ff6b6b', style: 'brick' },
      ],
      cars: [],
      people: { every: 6, max: 3 },
      budget: 2400, maxCharges: 10, planTime: 110,
    },
  ];
  root.LEVELS = LEVELS;
  if (typeof module !== 'undefined') module.exports = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
