# Ruffle Integration Guide

This project uses [Ruffle](https://ruffle.rs/) - a Flash Player emulator written in Rust - to play Flash/SWF content.

## Components

### RufflePlayer Component

Located at: `src/components/RufflePlayer.tsx`

A React component that wraps Ruffle for easy Flash content embedding.

#### Props

- `src` (required): URL to the SWF file
- `width`: Player width (default: "100%")
- `height`: Player height (default: "100%")
- `autoplay`: Auto-start the game (default: true)
- `backgroundColor`: Background color (default: "#000000")
- `letterbox`: Letterboxing mode - "on" | "off" | "fullscreen" (default: "on")
- `unmuteOverlay`: Show unmute overlay - "visible" | "hidden" (default: "visible")
- `quality`: Render quality - "low" | "medium" | "high" | "best" (default: "high")
- `scale`: Scaling mode - "showAll" | "exactFit" | "noBorder" | "noScale" (default: "showAll")
- `allowScriptAccess`: Allow ActionScript to access external scripts (default: false)
- `allowNetworking`: Network access - "all" | "internal" | "none" (default: "all")
- `className`: Additional CSS classes

#### Basic Usage

\`\`\`tsx
import { RufflePlayer } from "./components/RufflePlayer";

function MyGame() {
  return (
    <RufflePlayer
      src="/games/my-game.swf"
      width="800px"
      height="600px"
      autoplay={true}
    />
  );
}
\`\`\`

#### Advanced Usage

\`\`\`tsx
<RufflePlayer
  src="/games/advanced-game.swf"
  width="100%"
  height="100%"
  quality="best"
  scale="noBorder"
  backgroundColor="#1a1a1a"
  letterbox="fullscreen"
  allowScriptAccess={false}
  allowNetworking="internal"
  className="rounded-xl"
/>
\`\`\`

## Games View

Located at: `src/views/Games.tsx`

A complete games library interface that supports both Flash and HTML5 games.

### Features

- Game grid layout with thumbnails
- Click to play games in fullscreen
- Support for both Flash (SWF) and HTML5 games
- Back button to return to game library
- Add game functionality (ready for implementation)

### Adding Games

Games are stored in the Filer virtual filesystem at `/games/`. The system automatically reads all `.swf` files from this directory.

#### Adding a New Game

1. **Copy your SWF file to the games directory:**
   \`\`\`javascript
   // In browser console or through the app:
   const response = await fetch("/path/to/your/game.swf");
   const arrayBuffer = await response.arrayBuffer();
   const uint8Array = new Uint8Array(arrayBuffer);
   await window.fr.fs.promises.writeFile("/games/my-game.swf", uint8Array);
   \`\`\`

2. **Create metadata file (optional but recommended):**
   \`\`\`javascript
   await window.fr.fs.promises.writeFile(
     "/games/my-game.json",
     JSON.stringify({
       title: "My Awesome Game",
       type: "flash",
       thumbnail: "/path/to/thumbnail.jpg"
     }, null, 2)
   );
   \`\`\`

#### Metadata Format

Each game can have an optional JSON metadata file with the same name:
- `game.swf` → `game.json`

\`\`\`json
{
  "title": "Game Title",
  "type": "flash",
  "thumbnail": "/path/to/thumbnail.jpg"
}
\`\`\`

## File Organization

Games are organized in the Filer virtual filesystem:

\`\`\`
/games/
  game1.swf
  game1.json    # metadata (optional)
  game2.swf
  game2.json
  ...
\`\`\`

The games directory is automatically created during initialization, and a default game is copied from `/public/games/` to get you started.

Default games in `public/games/` are copied to the Filer FS on first run, making them available even if the public directory is cleared.

## Integration with Your App

The Games view is already set up to work with your tab system. To add a "Games" tab:

\`\`\`tsx
newTab({
  id: createId(),
  title: "Games",
  url: "about:games",
  icon: <PlayIcon className="size-5" />,
  displayUrl: "about:games",
});
\`\`\`

Then in your router, add:

\`\`\`tsx
if (item.url === "about:games") {
  return <Games key={viewKey} />;
}
\`\`\`

## Why Not react-ruffle?

We're using `@ruffle-rs/ruffle` directly instead of `react-ruffle` because:

1. **More actively maintained**: Official Ruffle package gets updates faster
2. **Better control**: Direct access to all Ruffle APIs
3. **Smaller bundle**: No extra wrapper overhead
4. **Better TypeScript support**: We can add our own type definitions
5. **More flexible**: Easy to customize player behavior

## Performance Tips

1. **Lazy loading**: Ruffle is loaded only when needed (dynamic import)
2. **Game optimization**: Use `quality="medium"` for older/simpler games
3. **Background color**: Match your theme for seamless loading
4. **Cleanup**: Players are properly disposed when unmounted

## Troubleshooting

### Game won't load
- Check the SWF file path is correct
- Ensure the file is in the `public` directory
- Check browser console for errors

### Poor performance
- Try lowering the `quality` prop
- Use `scale="noScale"` for pixel-perfect games
- Disable unnecessary features with `allowScriptAccess={false}`

### Audio issues
- Ensure `unmuteOverlay="visible"` is set
- Modern browsers require user interaction to play audio
- The overlay handles this automatically

## Resources

- [Ruffle Official Site](https://ruffle.rs/)
- [Ruffle Demo](https://ruffle.rs/demo/)
- [Flash Game Archives](https://bluemaxima.org/flashpoint/)

## License

Ruffle is licensed under Apache 2.0 or MIT license.
