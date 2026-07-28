import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { KnowledgeCollection, KnowledgeRecord } from "./types.js";

const ignoredDirectories = new Set([
  ".git",
  ".obsidian",
  ".trash",
  "dist",
  "node_modules",
]);

export async function readKnowledgeStore(
  root: string,
  collection: KnowledgeCollection = "knowledge",
): Promise<KnowledgeRecord[]> {
  const absoluteRoot = path.resolve(root);
  const files = await markdownFiles(absoluteRoot);
  return Promise.all(
    files.map((file) => readKnowledgeRecord(absoluteRoot, file, collection)),
  );
}

async function markdownFiles(root: string): Promise<string[]> {
  const output: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (entry.name.startsWith(".") || ignoredDirectories.has(entry.name))
      ) {
        continue;
      }
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        output.push(file);
      }
    }
  }

  await visit(root);
  return output.sort();
}

async function readKnowledgeRecord(
  root: string,
  absolutePath: string,
  collection: KnowledgeCollection,
): Promise<KnowledgeRecord> {
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = matter(raw);
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  const title =
    scalar(parsed.data.title) ??
    parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    path.basename(relativePath, path.extname(relativePath));
  const sourceRepository = normalizeRepository(
    scalar(parsed.data.source_repository) ?? scalar(parsed.data.repository),
  );
  const sourceCommit = normalizeCommit(
    scalar(parsed.data.source_commit) ?? scalar(parsed.data.commit),
  );

  return {
    id: `${collection}:${relativePath}`,
    collection,
    root,
    path: relativePath,
    absolutePath,
    title,
    type: (scalar(parsed.data.type) ?? "note").toLowerCase(),
    kind: scalar(parsed.data.kind) ?? scalar(parsed.data.experience_kind),
    status: scalar(parsed.data.status),
    confidence: scalar(parsed.data.confidence),
    sourceRepository,
    sourceCommit,
    tags: stringList(parsed.data.tags),
    links: wikiLinks(parsed.content),
    evidenceUrls: evidenceUrls(parsed.content),
    body: parsed.content.trim(),
  };
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => scalar(item))
      .filter((item): item is string => Boolean(item));
  }
  const single = scalar(value);
  return single ? [single] : [];
}

function normalizeRepository(value: string | null): string | null {
  if (!value) return null;
  const wikiAlias = value.match(/\[\[[^|\]]+\|([^\]]+)\]\]/)?.[1];
  const wikiTarget = value.match(/\[\[([^\]]+)\]\]/)?.[1];
  const repositoryUrl = value.match(/github\.com\/([^/\s]+\/[^/#\s]+)/)?.[1];
  return (wikiAlias ?? repositoryUrl ?? wikiTarget ?? value)
    .replace(/\.git$/i, "")
    .trim();
}

function normalizeCommit(value: string | null): string | null {
  if (!value) return null;
  return value.match(/\b[0-9a-f]{40}\b/i)?.[0] ?? value;
}

function wikiLinks(content: string): string[] {
  const links = [...content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)]
    .map((match) => match[1]?.trim())
    .filter((link): link is string => Boolean(link));
  return [...new Set(links)];
}

function evidenceUrls(content: string): string[] {
  const urls = content.match(
    /https:\/\/github\.com\/[^\s)<>\]]+(?:\/[^\s)<>\]]+)*/g,
  );
  return [...new Set((urls ?? []).map((url) => url.replace(/[.,;:]$/, "")))];
}
