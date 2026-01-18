import { access, cp, mkdir, readdir } from 'node:fs/promises';
import { basename, join, normalize, resolve, sep } from 'node:path';
import { agents } from './agents.js';
import type { AgentType, Skill } from './types.js';

interface InstallResult {
  success: boolean;
  path: string;
  error?: string;
}

/**
 * Sanitizes a filename/directory name to prevent path traversal attacks
 * @param name - The name to sanitize
 * @returns Sanitized name safe for use in file paths
 */
function sanitizeName(name: string): string {
  // Remove any path separators and null bytes
  let sanitized = name.replace(/[/\\:\0]/g, '');

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  // Replace any remaining dots at the start (to prevent ..)
  sanitized = sanitized.replace(/^\.+/, '');

  // If the name becomes empty after sanitization, use a default
  if (!sanitized || sanitized.length === 0) {
    sanitized = 'unnamed-skill';
  }

  // Limit length to prevent issues
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }

  return sanitized;
}

/**
 * Validates that a path is within an expected base directory
 * @param basePath - The expected base directory
 * @param targetPath - The path to validate
 * @returns true if targetPath is within basePath
 */
function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

export async function installSkillForAgent(
  skill: Skill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];

  // Sanitize skill name to prevent directory traversal
  const rawSkillName = skill.name || basename(skill.path);
  const skillName = sanitizeName(rawSkillName);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const targetDir = join(targetBase, skillName);

  // Validate that the target directory is within the expected base
  if (!isPathSafe(targetBase, targetDir)) {
    return {
      success: false,
      path: targetDir,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    await mkdir(targetDir, { recursive: true });
    await copyDirectory(skill.path, targetDir);

    return { success: true, path: targetDir };
  } catch (error) {
    return {
      success: false,
      path: targetDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

const EXCLUDE_FILES = new Set(['README.md', 'metadata.json']);

const isExcluded = (name: string): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith('_')) return true; // Templates, section definitions
  return false;
};

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (isExcluded(entry.name)) {
      continue;
    }

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await cp(srcPath, destPath);
    }
  }
}

export async function isSkillInstalled(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const agent = agents[agentType];

  // Sanitize skill name
  const sanitized = sanitizeName(skillName);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const skillDir = join(targetBase, sanitized);

  // Validate path safety
  if (!isPathSafe(targetBase, skillDir)) {
    return false;
  }

  try {
    await access(skillDir);
    return true;
  } catch {
    return false;
  }
}

export function getInstallPath(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {}
): string {
  const agent = agents[agentType];

  // Sanitize skill name
  const sanitized = sanitizeName(skillName);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const installPath = join(targetBase, sanitized);

  // Validate path safety
  if (!isPathSafe(targetBase, installPath)) {
    throw new Error('Invalid skill name: potential path traversal detected');
  }

  return installPath;
}
