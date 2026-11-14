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
| Retry / level select | | `R` / `Esc` |
| Music / sound effects | ♫ / 🔊 buttons | `M` / `S` |

### Rules and scoring

- **Planning timer**: each job has a time limit. When it runs out, whatever you planted
  goes off.
- **Strength**: columns need strength 3 or more to cut, and slabs need 4 or more. A weaker
  charge only loosens the joints. A stronger blast has a bigger radius and throws debris
  much harder; the kick grows faster than the strength does.
- **Fuse delay**: sequence the blasts. For example, cut the middle columns first so the
  outer walls get pulled inward.
- **Score** = collapse (up to 400) + debris kept on the lot (up to 400) + explosive
  efficiency (up to 200) − penalties for hitting neighbours + time bonus (up to 100).
- To pass, at least 60% of the building has to come down. Three stars needs a high score
  and no hits on the neighbours at all.

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
js/levels.js      the five demolition jobs
js/physics.js     building construction, explosives, collapse and scoring (also runs in Node)
js/render.js      canvas renderer, particles, dust and camera shake
js/audio.js       procedural music and sound effects
js/game.js        game flow, input and HUD
lib/matter.min.js Matter.js 0.20.0 (MIT)
```
