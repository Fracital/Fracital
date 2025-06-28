import fs from "fs";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const THEMES_DIR = path.join(__dirname, 'public', 'themes');
const OUTPUT_FILE = path.join(THEMES_DIR, 'themes.json');

function extractThemeName(filename: string) {
    // Remove extension and prettify
    return filename.replace(/\.css$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function extractColors(cssContent: string) {
    // Optionally extract some CSS variables for preview
    const colorVars: Record<string, string> = {};
    const matches = cssContent.matchAll(/--([\w-]+):\s*([^;]+);/g);
    for (const match of matches) {
        colorVars[match[1]] = match[2].trim();
    }
    return colorVars;
}

function main() {
    if (!fs.existsSync(THEMES_DIR)) {
        console.error('Themes directory not found:', THEMES_DIR);
        process.exit(1);
    }
    const files = fs.readdirSync(THEMES_DIR).filter(f => f.endsWith('.css'));
    const themes = files.map(filename => {
        const cssPath = path.join(THEMES_DIR, filename);
        const cssContent = fs.readFileSync(cssPath, 'utf8');
        return {
            filename,
            name: extractThemeName(filename),
            colors: extractColors(cssContent)
        };
    });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(themes, null, 2));
    console.log(`Wrote ${themes.length} themes to`, OUTPUT_FILE);
}

if (require.main === module) {
    main();
}
