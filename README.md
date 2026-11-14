# IMPLODE! — Controlled Demolition

A 2D, physics-based browser game with a cartoon look. You get a building wedged between
neighbours. Plant explosives, choose how strong each one is and when it fires, then bring the
building down onto its own footprint. Debris that hits the neighbouring buildings costs points.

## Play

There is no build step. Either:

- open `index.html` directly in a modern browser, or
- serve the folder, e.g. `python3 -m http.server` and visit <http://localhost:8000>.

### Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Plant a charge | Click/tap a column or floor slab | |
| Remove a charge | Click/tap the charge | |
| Zoom the camera | Pinch with two fingers / mouse wheel | `+` / `−` |
| Move the camera | Drag with one finger / click-drag | |
| Reset the camera | ⤢ button (shown while zoomed) | `V` |
| Charge strength (1–10) | Slider | `1`–`9`, `0` = 10 |
| Fuse delay (0–2 s) | Delay buttons | |
| Detonate | 💥 DETONATE | `Space` |
| Retry (keeps your charge layout) / level select | Retry button | `R` / `Esc` |
| Music / sound effects | ♫ / 🔊 buttons | `M` / `S` |

| Shoo a bystander | Tap/click the person | |
| Replay controls | ↺ restart · ❚❚/▶ · scrubber · ¼× ½× 1× | `Space` play/pause, `Esc` close |

### Budget, cash and the shop

- Every job has a **budget**. Each charge costs money: dynamite is $150 + $40 per strength
  level, shaped charges cost 60% more, and cutter charges are a flat $450. Unspent budget
  earns bonus points.
- A successful job pays **5 × your score** into your company cash. Repeating a job you've
  already cleared pays 30%.
- Spend the cash in the **🛒 shop**:

| Item | Price | Effect |
| --- | --- | --- |
| 📢 Megaphone | $800 | “Clear area” button that shoos every bystander at once |
| ⏱ Overtime Permit | $1,500 | +30 s planning time |
| 🎛 Precision Detonator | $2,000 | Finer fuse delays (0.1, 0.75, 2.5, 3 s) |
| 🩻 Load X-ray | $2,500 | Colours each column by the weight it carries and shows which ones will lose support (`X` key) |
| 🔻 Shaped Charges | $3,500 | Blast is focused toward the building's centre, so less debris flies outward |
| 🕸 Debris Netting | $4,000 | Nets on the neighbours ($600 per job); hits on them cost ~90% less |
| ✂ Cutter Charges | $5,000 | Slices any member, even steel, with almost no blast |

### Building types and street hazards

- **Concrete** is the classic: it collapses floor by floor into a dusty pile.
- **Brick** crumbles easily (strength 2+), but breaks into lots of rubble.
- **Steel** bends instead of shattering and needs strength 6+, or cutter charges.
- **Glass** curtain walls burst into shards when a blast goes off nearby.
- **Rooftop** water tanks and billboards sit high up and like to topple sideways.
- **Parked cars** in the street cost 30 points per hit (up to 3 hits per car), and their
  alarms go off.
- **Bystanders** wander into the danger zone while you plan. Tap them to send them away.
  Anyone still in the zone at detonation costs 75 points.
- The **historic church** next to the Old Brick Mill doubles neighbour-hit penalties.

### Directional jobs

Jobs 7 and 8 ask you to **topple** the building into a marked **drop zone** instead of
imploding it. Cut the columns on the drop-zone side (a wedge over the first floor or two)
and leave the far side standing as a hinge. A straight-down implosion, or a fall the wrong
way, fails the job.

### World Landmarks

A theme park full of landmark replicas is closing down, and you've got the contract:

- **🕰 Clock Tower:** a tall, narrow sandstone tower with a clock face (the hands show the
  real time) and a pointed spire. Implode it between two gothic buildings.
- **🏛 Leaning Tower:** a white marble arcade tower that already leans about 5°. Finish
  the job by toppling it the way it leans, into the piazza.
- **🗼 Iron Lattice Tower:** a wrought-iron truss of angled girders with two platforms
  and an arch. Cut the legs on one side so it pivots and falls across the park.

The lattice tower uses a separate *truss* builder. Each girder is a rigid bar welded to the
others at shared nodes, and a girder only collides with other members once it has torn
completely free. The leaning tower is a normal frame tilted about its base before the game
starts.

### News ticker

The results screen opens with a scrolling **BREAKING NEWS** ticker. Its headlines are
written from what actually happened: a clean implosion, a wrong-way topple, a cracked
church steeple, flattened cars, fleeing spectators, money saved, and so on.

### Instant replay

After every demolition, hit **🎬 Replay** to watch it again. You can play it at ¼×, ½× or
1× speed, scrub back and forth, and pinch-zoom anywhere.

### Rules and scoring

- **Planning timer**: each job has a time limit. When it runs out, whatever you planted
  goes off.
- **Strength**: columns need strength 3 or more to cut, and slabs need 4 or more. A weaker
  charge only loosens the joints. A stronger blast has a bigger radius and throws debris
  much harder; the kick grows faster than the strength does.
- **Fuse delay**: sequence the blasts. For example, cut the middle columns first so the
  outer walls get pulled inward.
- **Score** = collapse (up to 400) + debris kept on the lot (up to 400) + under-budget
  bonus (up to 200) − penalties (neighbours, cars, bystanders) + time bonus (up to 100).
- To pass, at least 60% of the building has to come down. Three stars needs a high score
  and no penalties at all.

## How the physics works

The game uses [Matter.js](https://brm.io/matter-js/) for rigid-body physics. It is
vendored in `lib/`, so the game also runs offline.

- **Building**: every column and floor-slab segment is its own rigid body. They are welded
  together with breakable joints at each connection. A joint breaks when it is stretched
  past a limit. The wall panels are non-structural cladding hung from the frame.
- **Explosions**: a charge shatters the member it is attached to if it is strong enough.
  It also breaks joints within its radius and sends a blast wave that falls off with
  distance and is resisted by each body's mass.
- **Progressive collapse**: once a column has fallen below where it was built and lands,
  the load from above crushes it. This is the floor-by-floor "pancake" collapse of a real
  implosion. A charge that only cuts one side makes the building lean and topple instead.
- **Hit detection**: building debris that strikes a neighbour faster than a threshold
  leaves a crack, flashes the neighbour red and costs 10–60 points, scaled by the
  debris's speed × mass.
- The simulation runs at a fixed 120 Hz step, so the outcome does not depend on frame rate.

The music and sound effects are made in real time with the Web Audio API, so there are no
audio files.

## Project layout

```
index.html        UI shell (HUD, toolbar, menus)
css/style.css     styling
js/levels.js      the eleven demolition jobs, including the landmarks
js/physics.js     building materials, explosives, collapse, cars, bystanders, replay
                  recording and scoring (also runs in Node)
js/render.js      canvas renderer, particles, dust and camera shake
js/audio.js       procedural music and sound effects
js/game.js        game flow, input and HUD
lib/matter.min.js Matter.js 0.20.0 (MIT)
```
