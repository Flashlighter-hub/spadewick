# How to name layers so that they bind

Name your layers after your fields (case, spaces, hyphens and underscores do not matter). Spadewick reads the layer name, id or label that the tool writes into the file.

- A text layer named Name or Cost is bound to the field of that name; the text it holds becomes the sample. A text that already has a field token in double braces keeps it.
- A rectangle named name_box (the text's name plus _box) is the box of that text: the text wraps in it and shrinks to fit.
- A layer named if:cost > 3 is shown only then; hide-if:… hides it. Use a field name in the condition.
- A layer named icon:fire becomes the icon fire from the icon library.
- Keep text as text when exporting: text that was turned into outlines cannot be bound.
- A picture or rectangle named after a picture field (art) becomes that field's picture; a shape named after a colour field takes its colour from it.

## Tools

- Figma: name the layers; export as SVG with “Include id attribute” on and “Outline text” off.
- Illustrator: name the layers and objects; Save As SVG with Object IDs set to Layer Names and Type set to SVG.
- Inkscape: give objects a label (Object → Layers and Objects); save as Plain SVG or Inkscape SVG.
- Affinity: name layers; export SVG with “Export text as curves” off. Sketch: name layers; export as SVG.
