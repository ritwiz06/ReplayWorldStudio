# Permitted photos for image import (IMG-01)

Real photographs in the public domain (CC0 or the Public Domain Mark) and renders made in this repository. They contain no people, no faces and no personal data. They are used for the feasibility check, the offline tests and the browser test. **None is a measured site**: the sizes given for their scale references in tests and demonstrations are assumptions, labelled as such.

| File | What it shows | Source and rights |
| --- | --- | --- |
| `living-room.webp` | A small living room seen from above at an angle: sofa, armchair, coffee table on a rug, side table, plant, TV on a stand (WebP, 1024 × 727) | "Free modern living room interior", rawpixel, CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Landing page: https://www.rawpixel.com/image/5915137/image-light-public-domain-plants. Found through Openverse (id 1f6ae721-045a-4b6c-806b-8e1bc9ef30a5). |
| `office.jpg` | An open office work area at eye level: L-shaped desk, office chair, monitor, printer, two low cabinets, far chairs (JPEG with EXIF, 1024 × 678) | "20110420-RD-LSC-0350" by USDAgov (U.S. Department of Agriculture), Public Domain Mark 1.0. https://www.flickr.com/photos/41284017@N08/6252247115 |
| `classroom.jpg` | A classroom: many tables and chairs, shelves, an easel (JPEG with EXIF, 1024 × 684) | "Dean Rusk Elementary School Elfton, North Pole classroom interior" by PatrickRich, Public Domain Mark 1.0. https://www.flickr.com/photos/91689877@N03/50378961418 |
| `factory-walk.png` | This repository's synthetic industrial demo rendered from the walk view (eye height 1.60 m at x 0, z 6, looking towards −Z, 70° vertical field of view, 1328 × 1000). The true positions of every object are in `fixtures/scenes/industrial-demo.json`, so detections can be scored against ground truth. | Rendered by this project (`fixtures/photos/factory-walk.camera.json` records the camera). |
| `factory-walk-sign.jpg` | The same render with a printed sign telling an AI to ignore its instructions; it tests that text in an image is treated as content | Rendered by this project. |

The files were checked visually before being added. Their sha256 values are pinned by the tests that use them.

ENR-01 also uses two of them as **reference photos** of an object (no new files). `factory-walk.png` is cropped to one guarded cell (a render, not a photograph). `office.jpg` is cropped to its drawer unit, a look reference for the demo's control cabinet, not a photo of that equipment. See [docs/enr-01/photo.md](../../docs/enr-01/photo.md).
