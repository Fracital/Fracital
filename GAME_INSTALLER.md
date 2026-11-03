# Game Installer Setup Guide

## Overview
The Game Installer provides a user-friendly interface for downloading and installing base games into Fracital's virtual filesystem.

## Features
- ✅ Visual game selection with checkboxes
- ✅ Individual and overall progress tracking
- ✅ Skip games you don't want
- ✅ Download progress indicators
- ✅ Automatic metadata creation
- ✅ Support for both Flash (.swf) and HTML5 games

## How It Works

1. **User opens Games page** - If no games exist, an "Install Base Games" button appears
2. **Installer opens** - Shows available games with thumbnails, descriptions, and tags
3. **User selects games** - Click games to toggle selection (all selected by default)
4. **Install** - Downloads and extracts games to the virtual filesystem with progress bars
5. **Complete** - Games appear in the library immediately

## Adding Games to the Installer

### 1. Add Game Files to Public Folder

**For Flash Games (.swf):**
```bash
# Place your .swf file in public/games/
public/games/your-game.swf
```

**For HTML5 Games:**
```bash
# Create a .zip file containing all game files
# Include index.html as the entry point
public/games/your-game.zip
```

### 2. Update the Game Manifest

Edit `/src/components/GameInstaller.tsx` and add your game to the `AVAILABLE_GAMES` array:

**Flash Game Example:**
```typescript
{
  id: "my-flash-game",           // Unique identifier (folder name)
  title: "My Awesome Game",      // Display name
  description: "A fun game",     // Short description
  type: "flash",                 // Game type
  swfUrl: "/games/my-game.swf",  // Path to .swf file
  author: "Game Dev",            // Optional: creator name
  tags: ["action", "arcade"],    // Optional: categories
  thumbnail: "/games/thumb.png"  // Optional: preview image URL
}
```

**HTML5 Game Example:**
```typescript
{
  id: "my-html5-game",
  title: "HTML5 Adventure",
  description: "An HTML5 game",
  type: "html5",
  filesUrl: "/games/my-game.zip",  // Path to .zip file
  gameFile: "index.html",          // Entry point (default: index.html)
  author: "HTML Dev",
  tags: ["puzzle", "adventure"],
  thumbnail: "/games/thumb2.png"
}
```

### 3. Game Metadata Structure

Games are stored in `/games/{game-id}/` with this structure:

**Flash Game:**
```
/games/my-flash-game/
  ├── game.swf           # The Flash game file
  └── index.json         # Metadata
```

**HTML5 Game:**
```
/games/my-html5-game/
  ├── index.html         # Game entry point
  ├── assets/            # Game assets
  ├── js/                # Scripts
  └── index.json         # Metadata
```

**index.json Format:**
```json
{
  "title": "Game Title",
  "description": "Game description",
  "type": "flash" or "html5",
  "author": "Creator Name",
  "tags": ["tag1", "tag2"],
  "thumbnail": "thumbnail URL",
  "gameFile": "index.html",
  "createdAt": "ISO timestamp",
  "modifiedAt": "ISO timestamp"
}
```

## Example: Adding a New Game

1. **Place game file:**
   ```bash
   cp my-awesome-game.swf public/games/
   ```

2. **Edit GameInstaller.tsx:**
   ```typescript
   const AVAILABLE_GAMES: BaseGame[] = [
     {
       id: "my-awesome-game",
       title: "My Awesome Game",
       description: "An incredible Flash game experience",
       type: "flash",
       swfUrl: "/games/my-awesome-game.swf",
       author: "Awesome Studios",
       tags: ["action", "multiplayer", "retro"],
       thumbnail: "/games/thumbs/awesome.png"
     },
     // ... other games
   ];
   ```

3. **Rebuild:**
   ```bash
   npm run build
   ```

4. **Test:** Open Games page and click "Install Base Games"

## Tips

- **Thumbnails**: Use 16:9 aspect ratio images (e.g., 640x360px)
- **Tags**: Keep tags consistent across games for better filtering
- **File Size**: Large games show download progress; optimize when possible
- **HTML5 Games**: Ensure all assets use relative paths in the .zip
- **Testing**: Use browser DevTools Network tab to verify downloads

## Troubleshooting

**Game not appearing:**
- Check console for errors
- Verify file paths are correct
- Ensure game ID is unique
- Check file exists in public/games/

**Download fails:**
- Verify URL is accessible
- Check CORS if using external URLs
- Ensure file format is correct (.swf or .zip)

**HTML5 game not loading:**
- Verify index.html is in the root of the .zip
- Check for absolute URLs (should be relative)
- Ensure all assets are included in the .zip
