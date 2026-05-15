// lib/skills/scanner.js
// Owns: Discovering and parsing skills from the /skills directory
// Does NOT own: Running skills, HTTP handling, Sheet access

const fs   = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

/**
 * Walk the /skills directory and return all valid skill manifests.
 * A skill is valid if its folder contains manifest.json and system.md.
 *
 * Returns: Array of manifest objects, each augmented with:
 *   - hasTools: boolean (true if tools.json exists)
 */
function scanSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .reduce((acc, dir) => {
      const skillDir = path.join(SKILLS_DIR, dir.name);
      const manifestPath = path.join(skillDir, 'manifest.json');
      const systemPath   = path.join(skillDir, 'system.md');
      const toolsPath    = path.join(skillDir, 'tools.json');

      if (!fs.existsSync(manifestPath) || !fs.existsSync(systemPath)) return acc;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.hasTools = fs.existsSync(toolsPath);
        manifest._dir = skillDir;
        acc.push(manifest);
      } catch (_) {
        // Malformed manifest.json — skip silently
      }
      return acc;
    }, []);
}

/**
 * Load the full content for a single skill by id.
 * Returns { manifest, systemPrompt, tools } or null if not found.
 */
function loadSkill(skillId) {
  const skills = scanSkills();
  const manifest = skills.find(s => s.id === skillId);
  if (!manifest) return null;

  const systemPrompt = fs.readFileSync(path.join(manifest._dir, 'system.md'), 'utf8');
  let tools = null;
  const toolsPath = path.join(manifest._dir, 'tools.json');
  if (manifest.hasTools) {
    try { tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8')); } catch (_) {}
  }

  return { manifest, systemPrompt, tools };
}

module.exports = { scanSkills, loadSkill };
