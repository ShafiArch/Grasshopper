# Real captures (optional)

The site draws a schematic animation for every definition in the browser, so it works with no images at all.

If you want a card to show a real Grasshopper capture instead, drop a `.gif`, `.mp4` or `.webm` in this folder and point the card at it in `assets/site.js`:

```js
{ file: 'Surface_Voronoi.gh', title: 'Surface Voronoi', media: 'previews/surface-voronoi.gif', ... }
```

Tips for captures that fit the page:

- 4:3 aspect ratio (for example 800 x 600) so the card does not crop.
- Keep each file under 2 MB. GitHub Pages serves them as plain files.
- A white or very light viewport background sits best on the page.
- Muted `.mp4` or `.webm` loops are far smaller than GIFs for the same length.
