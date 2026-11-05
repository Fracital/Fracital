# Game Store Format

This document describes the JSON format for creating game stores that can be used with Fracital's Downloads tab.

## Store JSON Structure

```json
{
	"name": "My Game Store",
	"description": "A collection of awesome games",
	"version": "1.0.0",
	"games": [
		{
			"id": "unique-game-id",
			"title": "Game Title",
			"description": "A detailed description of the game",
			"author": "Game Developer",
			"version": "1.0.0",
			"type": "flash",
			"tags": ["action", "arcade", "platformer"],
			"thumbnail": "https://example.com/thumbnail.jpg",
			"swfUrl": "https://example.com/game.swf"
		},
		{
			"id": "html5-game",
			"title": "HTML5 Game",
			"description": "An HTML5 game with multiple files",
			"author": "Web Developer",
			"type": "html5",
			"tags": ["puzzle", "strategy"],
			"thumbnail": "https://example.com/html5-thumb.jpg",
			"filesUrl": "https://example.com/game.zip",
			"gameFile": "index.html"
		}
	]
}
```

## Field Descriptions

### Store Level

- `name` (string, required): Display name of the store
- `description` (string, optional): Brief description of the store
- `version` (string, optional): Version of the store manifest
- `games` (array, required): Array of game objects

### Game Object

- `id` (string, required): Unique identifier for the game (no spaces, lowercase recommended)
- `title` (string, required): Display name of the game
- `description` (string, required): Detailed description shown to users
- `author` (string, optional): Game creator/developer name
- `version` (string, optional): Game version number
- `type` (string, required): Either `"flash"` or `"html5"`
- `tags` (array, optional): Array of tag strings for categorization
- `thumbnail` (string, optional): URL to game thumbnail image (recommended 16:9 aspect ratio)

### Flash Games (type: "flash")

- `swfUrl` (string, required): Direct URL to the .swf file

### HTML5 Games (type: "html5")

- `filesUrl` (string, required): URL to a .zip file containing all game files
- `gameFile` (string, optional): Entry point HTML file (defaults to "index.html")

## Example Stores

### Official Fracital Store

```json
{
	"name": "Official Fracital Store",
	"description": "Curated collection of classic Flash and HTML5 games",
	"games": [
		{
			"id": "super-mario-63",
			"title": "Super Mario 63",
			"description": "A Flash remake of Super Mario with custom levels and features",
			"author": "Runouw",
			"type": "flash",
			"tags": ["platformer", "mario", "classic", "adventure"],
			"thumbnail": "https://example.com/sm63.jpg",
			"swfUrl": "https://cdn.example.com/games/sm63.swf"
		}
	]
}
```

### Community Store

```json
{
	"name": "Community Games",
	"description": "Games created by the Fracital community",
	"games": [
		{
			"id": "puzzle-quest",
			"title": "Puzzle Quest",
			"description": "Match-3 puzzle game with RPG elements",
			"author": "CommunityDev",
			"type": "html5",
			"tags": ["puzzle", "match-3", "rpg"],
			"thumbnail": "https://example.com/puzzle-quest.png",
			"filesUrl": "https://example.com/puzzle-quest.zip"
		}
	]
}
```

## Hosting Your Store

1. Create a JSON file following the format above
2. Host it on a publicly accessible URL (GitHub Pages, CDN, etc.)
3. Add the URL to `GAME_STORES` array in `src/components/GameInstaller.tsx`:

```typescript
const GAME_STORES: GameStore[] = [
	{
		name: "Your Store Name",
		url: "https://your-domain.com/store.json",
		description: "Your store description",
	},
];
```

## CORS Requirements

The server hosting your store JSON and game files must:
- Allow CORS requests from Fracital domains
- Serve files with appropriate Content-Type headers
- Support range requests for large files (optional but recommended)

### Example CORS Headers

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Base Games

Base games are automatically discovered from the `src/assets/games` directory. They don't need to be added to store JSON files.

Each base game folder should contain:
- `index.json` - Metadata file
- Game file(s) - `.swf` for Flash, or multiple files for HTML5
- `index.jpg` (optional) - Thumbnail image

Example `index.json` for base game:
```json
{
	"title": "Game Title",
	"description": "Game description",
	"author": "Developer Name",
	"version": "1.0.0",
	"type": "flash",
	"tags": ["tag1", "tag2"]
}
```

## Best Practices

1. **Thumbnails**: Use 640x360px (16:9) images for consistent display
2. **File Size**: Keep individual files under 50MB when possible
3. **Descriptions**: Write clear, concise descriptions (100-200 characters)
4. **Tags**: Use lowercase, hyphenated tags (e.g., "time-management", not "Time Management")
5. **IDs**: Use lowercase with hyphens, no special characters
6. **URLs**: Use HTTPS for all external resources
7. **Testing**: Test your store JSON in a validator before publishing
8. **CDN**: Use a CDN for faster game downloads

## Store Discovery

Future versions may support automatic store discovery. For now, stores must be manually added to the codebase.
