# Pet Everything

A little web toy for petting photorealistic animals, seen from above. Put your hand on one and stroke it: the fur gets dragged by your palm, pressed down, bunched up between your fingers, and ruffled when you go against the grain. The animals purr, pant and grumble — the hedgehog and the cactus will make your hand bleed, and the red-hot iron will burn it.

**Play it online: <https://pet-everything.stv1024.asia>**

![Screenshots of four animals: an orange cat, a Shiba Inu, a hedgehog and an orca](docs/images/screenshot.webp)

Inspired by [Pet the Cat](https://pet-the-cat.pages.dev/) by [@zubububu](https://x.com/zubububu), and extended with more animals and objects. The Chinese name, 万物皆可撸, means roughly "everything is pettable".

## How to play

| Input | Action |
| --- | --- |
| Move the mouse over the animal | Stroke |
| Hold the left button | Press harder |
| Quick click | Pat |
| Bottom bar | Change animal and coat |
| ← → | Change animal |
| Space | Auto-stroke |
| M / F | Mute / Fullscreen |

On a phone, use your finger.

## Animals and objects

Cat (6 coats), Shiba Inu (4), Holland Lop rabbit (5), hedgehog (3), tiger (3), crocodile, orca, a golden barrel cactus (plain or in bloom), and a red-hot iron block on a glowing hot plate.

Each one has its own likes, sounds and feel. The tiger and the orca are much bigger than your hand; the crocodile and the cactus are hard and barely give; the hedgehog is fine if you stroke along its spines, but going against them hurts. The iron sizzles and smokes under your hand, which slowly gets burnt — red, then blistered, then charred.

## How it works

- **Images**: each animal is one AI-generated top-down photo (generated on a green or magenta screen, then keyed out), mapped onto a WebGL mesh that deforms in real time.
- **Touch**: under the palm there is an elliptical contact patch. The skin is dragged along with the hand and springs back when the hand stops; it sinks inside the patch, bulges around it and bunches up in front of a moving hand, with shading from a light at the top left (`src/engine/skinPress.ts`).
- **Fur**: the fur direction is estimated from the photo. Stroking against it lifts the fur tips, which look brighter and messier for about a second (`src/engine/gl/skin.ts`).
- **Blood**: when a spine pricks the hand, drops land on the surface under the fingers, bloody fingers leave fading smears, and a bleeding hand drips onto the floor.
- **Burns**: 28 sample points on the hand (fingers, thumb, palm) heat up where they touch something hot. A low-resolution burn map is built from them, colored from red to charred black and multiplied onto the hand photo, with blisters and ash on top.
- **Sound**: everything is synthesized live with Web Audio — no audio files. The purr is an offline-rendered loop, calls use formant synthesis, and the rubbing noise changes with the material and the hand speed.
- **Stack**: Vite + TypeScript, no UI framework. Three stacked canvases: background (2D), animal (WebGL2), hand and particles (2D).

## Run locally

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev        # http://127.0.0.1:5188/
```

On Windows you can also double-click `打开游戏.bat` ("open game") in the repo root.

To add an animal or object, see the asset pipeline ([docs/写实素材管线.md](docs/写实素材管线.md): image generation, keying, landmarks) and the species guide ([docs/物种开发指南.md](docs/物种开发指南.md): `PhotoDef` fields, debugging tools). The developer docs are in Chinese. The image generation script needs your own image API endpoint and key (see the asset pipeline doc).

## Credits

- This project is inspired by **[Pet the Cat](https://pet-the-cat.pages.dev/)** by [@zubububu](https://x.com/zubububu). The top-down view, the photorealistic look and the palm-contact deformation all come from the original. This is an unofficial fan remake and extension that adds more animals, objects and interactions.
- The palm-contact deformation model (skin shear spring, patch compression, surrounding bulge, a fold in front of the hand, short-lived fur gloss) follows the original's approach: we studied the original's public web front end and re-implemented it in our own code. This repository contains no code, images or other assets from the original.
- The name, look and code of "Pet the Cat" belong to its author. If the original author has any concerns about this project, please [open an issue](https://github.com/stv1024/pet-everything/issues).
- The images of the animals, the hand and the floors were generated with GPT Image (`gpt-image-2.6`); the prompts are in [assets/prompts/](assets/prompts/).
- Built with a lot of help from [Claude Code](https://claude.com/claude-code).

## License

The code and the image assets in this repository are released under the [MIT License](LICENSE).
